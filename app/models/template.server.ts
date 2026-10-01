import type { InvoiceTemplate, Prisma } from "@prisma/client";

import prisma from "../db.server";
import type { DocumentType } from "../types/index";
import {
  SYSTEM_TEMPLATE_CATALOG_VERSION,
  SYSTEM_TEMPLATES,
} from "./system-template-catalog";
import { getDefaultConfigForLayout } from "./template-config.defaults";
import {
  enforceComplianceLocks,
  parseTemplateConfig,
  type BaseLayoutCode,
  type ComplianceLockOptions,
  type TemplateConfig,
} from "./template-config.types";

const SYSTEM_CODES = SYSTEM_TEMPLATES.map((t) => t.code);

let ensurePromise: Promise<void> | null = null;
let ensuredCatalogVersion: number | null = null;

function asDocumentType(value: string | null | undefined): DocumentType {
  if (
    value === "credit_note" ||
    value === "packing_slip" ||
    value === "refund_document" ||
    value === "tax_invoice"
  ) {
    return value;
  }
  return "tax_invoice";
}

function asBaseLayoutCode(value: string | null | undefined): BaseLayoutCode {
  return (value ?? "modern") as BaseLayoutCode;
}

export function resolveConfig(
  template: {
    config?: unknown;
    baseLayoutCode?: string | null;
    documentType?: string | null;
  },
  fallbackLayout: BaseLayoutCode,
  options: ComplianceLockOptions = {},
): TemplateConfig {
  const documentType = asDocumentType(template.documentType);
  if (template.config) {
    try {
      return enforceComplianceLocks(
        parseTemplateConfig(template.config),
        documentType,
        options,
      );
    } catch {
      return getDefaultConfigForLayout(fallbackLayout, documentType);
    }
  }
  return getDefaultConfigForLayout(fallbackLayout, documentType);
}

async function upsertSystemTemplate(template: (typeof SYSTEM_TEMPLATES)[number]) {
  const config = getDefaultConfigForLayout(
    template.baseLayoutCode,
    template.documentType,
  );
  const data = {
    code: template.code,
    name: template.name,
    description: template.description,
    htmlPath: template.htmlPath,
    baseLayoutCode: template.baseLayoutCode,
    config: config as unknown as Prisma.InputJsonValue,
    documentType: template.documentType,
    sourceType: "layout" as const,
    isSystem: true,
    isActive: true,
    storeId: null,
    merchantId: null,
    version: SYSTEM_TEMPLATE_CATALOG_VERSION,
  };

  const existing = await prisma.invoiceTemplate.findFirst({
    where: { code: template.code, isSystem: true },
  });

  if (existing) {
    await prisma.invoiceTemplate.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.invoiceTemplate.create({ data });
}

async function runEnsureSystemTemplates() {
  if (ensuredCatalogVersion === SYSTEM_TEMPLATE_CATALOG_VERSION) {
    return;
  }

  const activeCount = await prisma.invoiceTemplate.count({
    where: {
      isSystem: true,
      isActive: true,
      code: { in: SYSTEM_CODES },
    },
  });
  if (activeCount >= SYSTEM_CODES.length) {
    ensuredCatalogVersion = SYSTEM_TEMPLATE_CATALOG_VERSION;
    return;
  }

  for (const template of SYSTEM_TEMPLATES) {
    await upsertSystemTemplate(template);
  }

  await prisma.invoiceTemplate.updateMany({
    where: {
      isSystem: true,
      code: { notIn: SYSTEM_CODES },
    },
    data: { isActive: false },
  });

  ensuredCatalogVersion = SYSTEM_TEMPLATE_CATALOG_VERSION;
}

export async function ensureSystemTemplates() {
  if (!ensurePromise) {
    ensurePromise = runEnsureSystemTemplates().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

/** Test helper — clears in-memory ensure cache (matches process restart). */
export function resetSystemTemplateEnsureStateForTests() {
  ensurePromise = null;
  ensuredCatalogVersion = null;
}

export async function getActiveStoreForShop(shopDomain: string) {
  return prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
}

export type ResolvedShopTemplate = {
  template: InvoiceTemplate;
  config: TemplateConfig;
  documentType: DocumentType;
};

export async function resolveTemplateForShop(
  shopDomain: string,
  requestedId?: string,
  documentType: DocumentType = "tax_invoice",
): Promise<ResolvedShopTemplate | null> {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  if (requestedId) {
    const byId = await prisma.invoiceTemplate.findUnique({
      where: { id: requestedId },
    });
    if (byId?.isActive) {
      if (byId.isSystem || byId.storeId === store.id) {
        const layout = asBaseLayoutCode(byId.baseLayoutCode);
        return {
          template: byId,
          config: resolveConfig(byId, layout),
          documentType: asDocumentType(byId.documentType),
        };
      }
    }
  }

  const defaultId =
    documentType === "packing_slip"
      ? store.defaultPackingSlipTemplateId
      : documentType === "credit_note"
        ? store.defaultCreditNoteTemplateId
        : documentType === "refund_document"
          ? store.defaultRefundDocumentTemplateId
          : store.defaultTemplateId;

  if (defaultId) {
    const defaultTpl = await prisma.invoiceTemplate.findUnique({
      where: { id: defaultId },
    });
    if (
      defaultTpl?.isActive &&
      asDocumentType(defaultTpl.documentType) === documentType
    ) {
      const layout = asBaseLayoutCode(defaultTpl.baseLayoutCode);
      return {
        template: defaultTpl,
        config: resolveConfig(defaultTpl, layout),
        documentType,
      };
    }
  }

  const fallbackCode =
    documentType === "packing_slip"
      ? "packing-slip"
      : documentType === "credit_note"
        ? "credit-note"
        : documentType === "refund_document"
          ? "refund-document"
          : "modern";

  const fallback = await prisma.invoiceTemplate.findFirst({
    where: {
      isSystem: true,
      code: fallbackCode,
      isActive: true,
    },
  });
  if (!fallback) return null;

  return {
    template: fallback,
    config: resolveConfig(
      fallback,
      asBaseLayoutCode(fallback.baseLayoutCode),
    ),
    documentType: asDocumentType(fallback.documentType),
  };
}
