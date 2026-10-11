import { Prisma, type InvoiceTemplate, type Store } from "@prisma/client";

import prisma from "../db.server";
import type { DocumentType } from "../types/index";
import { getBrandingInputForShop } from "./branding.server";
import {
  sanitizeTemplateConfigContent,
  sanitizeTemplateTranslations,
} from "./rich-text.server";
import {
  SYSTEM_TEMPLATE_CATALOG_VERSION,
  SYSTEM_TEMPLATES,
} from "./system-template-catalog";
import {
  getDefaultConfigForLayout,
  mergeConfigWithBranding,
} from "./template-config.defaults";
import {
  BASE_LAYOUT_CODES,
  enforceComplianceLocks,
  parseTemplateConfig,
  templateConfigSchema,
  type BaseLayoutCode,
  type ComplianceLockOptions,
  type TemplateConfig,
} from "./template-config.types";
import {
  buildLiquidFromConfig,
  defaultLiquidSource,
  starterLiquidFor,
  templateSourceKind,
  validateLiquidSource,
  type LiquidValidation,
} from "./template-liquid.server";
import { applyConfigToExistingLiquid } from "./template-liquid-sync.server";
import {
  sourceHasInvoiceNumber,
  stripInvoiceNumberOutputs,
} from "./template-liquid-extract";

const SYSTEM_CODES = SYSTEM_TEMPLATES.map((t) => t.code);

export const SYSTEM_TEMPLATES_PAGE_SIZE = 12;

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

export function parseDocumentType(value: unknown): DocumentType {
  return asDocumentType(typeof value === "string" ? value : undefined);
}

function asBaseLayoutCode(value: string | null | undefined): BaseLayoutCode {
  const code = (value ?? "modern") as BaseLayoutCode;
  return BASE_LAYOUT_CODES.includes(code) ? code : "modern";
}

export function parseBaseLayoutCode(value: unknown): BaseLayoutCode | null {
  if (typeof value !== "string") return null;
  return BASE_LAYOUT_CODES.includes(value as BaseLayoutCode)
    ? (value as BaseLayoutCode)
    : null;
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
    try {
      await prisma.invoiceTemplate.update({
        where: { id: existing.id },
        data,
      });
      return;
    } catch (error) {
      // Concurrent tests may delete the row between find and update (P2025).
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        )
      ) {
        throw error;
      }
    }
  }

  try {
    await prisma.invoiceTemplate.create({ data });
  } catch (error) {
    // Concurrent ensure may create the same system code (partial unique).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = await prisma.invoiceTemplate.findFirst({
        where: { code: template.code, isSystem: true },
      });
      if (again) {
        await prisma.invoiceTemplate.update({
          where: { id: again.id },
          data,
        });
        return;
      }
    }
    throw error;
  }
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

/** Alias matching old getStoreForShop. */
export const getStoreForShop = getActiveStoreForShop;

export type ResolvedShopTemplate = {
  template: InvoiceTemplate;
  config: TemplateConfig;
  documentType: DocumentType;
};

export type TemplateListItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  baseLayoutCode: BaseLayoutCode;
  documentType: DocumentType;
  theme: { primary: string; accent: string; secondary: string };
  tags: string[];
  isDefault: boolean;
  isSystem: boolean;
  isCustom: boolean;
  updatedAt?: string;
  /** Lazy thumbnail URL (old `/app/templates/:id/thumbnail?v=updatedAt`). */
  thumbnailUrl: string;
  /**
   * Cached JPEG as a data URL when available (avoids embedded-admin auth on <img>).
   * Null until a thumbnail has been generated; list UI falls back to a CSS mini-preview.
   */
  thumbnailDataUrl: string | null;
};

function defaultIdForType(
  store: {
    defaultTemplateId?: string | null;
    defaultPackingSlipTemplateId?: string | null;
    defaultCreditNoteTemplateId?: string | null;
    defaultRefundDocumentTemplateId?: string | null;
  },
  documentType: DocumentType,
): string {
  if (documentType === "packing_slip") {
    return store.defaultPackingSlipTemplateId ?? "";
  }
  if (documentType === "credit_note") {
    return store.defaultCreditNoteTemplateId ?? "";
  }
  if (documentType === "refund_document") {
    return store.defaultRefundDocumentTemplateId ?? "";
  }
  return store.defaultTemplateId ?? "";
}

function themeForListItem(
  template: { config?: unknown },
  system?: { theme: { primary: string; accent: string; secondary: string } },
): { primary: string; accent: string; secondary: string } {
  if (system?.theme) return system.theme;
  if (template.config && typeof template.config === "object") {
    const branding = (
      template.config as {
        branding?: {
          primaryColor?: string;
          accentColor?: string;
          secondaryColor?: string;
        };
      }
    ).branding;
    if (branding?.primaryColor) {
      return {
        primary: branding.primaryColor,
        accent: branding.accentColor || branding.primaryColor,
        secondary: branding.secondaryColor || "#6d7175",
      };
    }
  }
  return { primary: "#008060", accent: "#004c3f", secondary: "#6d7175" };
}

function documentTypeWhere(
  documentType: DocumentType,
): Prisma.InvoiceTemplateWhereInput {
  // New schema always stores documentType; exact match is sufficient.
  return { documentType };
}

function mapTemplateListItem(
  template: InvoiceTemplate,
  store: Store,
  meta: Record<string, (typeof SYSTEM_TEMPLATES)[number]>,
  documentType: DocumentType,
  options?: { embedThumbnails?: boolean },
): TemplateListItem {
  const system = meta[template.code];
  const layout = asBaseLayoutCode(
    template.baseLayoutCode ?? system?.baseLayoutCode,
  );
  const docType = asDocumentType(
    template.documentType ?? system?.documentType ?? documentType,
  );
  const defaultId = defaultIdForType(store, docType);
  const embedThumbnails = options?.embedThumbnails !== false;
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description ?? system?.description ?? "",
    baseLayoutCode: layout,
    documentType: docType,
    theme: themeForListItem(template, system),
    tags: template.isSystem
      ? [...(system?.tags ?? ["Document"])]
      : templateSourceKind(template) === "code"
        ? ["Liquid", "Custom"]
        : templateSourceKind(template) === "imported"
          ? ["Imported", "Custom"]
          : ["Custom", layout],
    isDefault: template.id === defaultId,
    isSystem: Boolean(template.isSystem),
    isCustom: !template.isSystem,
    updatedAt: template.updatedAt
      ? new Date(template.updatedAt).toISOString()
      : "",
    thumbnailUrl: (() => {
      const v = template.updatedAt
        ? new Date(template.updatedAt).toISOString()
        : "";
      const base = `/app/settings/templates/${encodeURIComponent(template.id)}/thumbnail`;
      return v ? `${base}?v=${encodeURIComponent(v)}` : base;
    })(),
    thumbnailDataUrl:
      embedThumbnails && template.thumbnailJpeg
        ? `data:image/jpeg;base64,${Buffer.from(template.thumbnailJpeg).toString("base64")}`
        : null,
  };
}

function customCode(
  storeId: string,
  baseLayoutCode: string,
  documentType: DocumentType,
): string {
  const prefix =
    documentType === "packing_slip"
      ? "ps"
      : documentType === "credit_note"
        ? "cn"
        : documentType === "refund_document"
          ? "rd"
          : "inv";
  return `${prefix}-${storeId.slice(-6)}-${baseLayoutCode}-${Date.now().toString(36)}`;
}

export async function getTemplatesForShop(
  shopDomain: string,
  documentType?: DocumentType,
  options?: { skipEnsure?: boolean; embedThumbnails?: boolean },
) {
  if (!options?.skipEnsure) {
    await ensureSystemTemplates();
  }

  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const meta = Object.fromEntries(SYSTEM_TEMPLATES.map((t) => [t.code, t]));
  const embedThumbnails = options?.embedThumbnails !== false;
  // Skip loading JPEG blobs when the UI will fetch /thumbnail lazily.
  const listOmit = embedThumbnails
    ? undefined
    : ({ thumbnailJpeg: true } as const);
  const mapOpts = { embedThumbnails };

  if (documentType) {
    const typeWhere = documentTypeWhere(documentType);
    const [systemTemplates, customTemplates] = await Promise.all([
      prisma.invoiceTemplate.findMany({
        where: { isSystem: true, isActive: true, ...typeWhere },
        orderBy: { name: "asc" },
        ...(listOmit ? { omit: listOmit } : {}),
      }),
      prisma.invoiceTemplate.findMany({
        where: {
          storeId: store.id,
          isSystem: false,
          isActive: true,
          ...typeWhere,
        },
        orderBy: { updatedAt: "desc" },
        ...(listOmit ? { omit: listOmit } : {}),
      }),
    ]);
    const systemItems = systemTemplates.map((t) =>
      mapTemplateListItem(t as InvoiceTemplate, store, meta, documentType, mapOpts),
    );
    const customItems = customTemplates.map((t) =>
      mapTemplateListItem(t as InvoiceTemplate, store, meta, documentType, mapOpts),
    );
    return {
      store,
      systemItems,
      customItems,
      items: [...customItems, ...systemItems],
    };
  }

  const [systemTemplates, customTemplates] = await Promise.all([
    prisma.invoiceTemplate.findMany({
      where: { isSystem: true, isActive: true },
      orderBy: { name: "asc" },
      ...(listOmit ? { omit: listOmit } : {}),
    }),
    prisma.invoiceTemplate.findMany({
      where: { storeId: store.id, isSystem: false, isActive: true },
      orderBy: { updatedAt: "desc" },
      ...(listOmit ? { omit: listOmit } : {}),
    }),
  ]);

  const systemItems = systemTemplates.map((template) => {
    const system = meta[template.code];
    const docType = asDocumentType(
      template.documentType ?? system?.documentType,
    );
    return mapTemplateListItem(
      template as InvoiceTemplate,
      store,
      meta,
      docType,
      mapOpts,
    );
  });
  const customItems = customTemplates.map((template) => {
    const docType = asDocumentType(template.documentType);
    return mapTemplateListItem(
      template as InvoiceTemplate,
      store,
      meta,
      docType,
      mapOpts,
    );
  });

  return {
    store,
    systemItems,
    customItems,
    items: [...customItems, ...systemItems],
  };
}

/**
 * Overview helper: only the selected (default) template per document type.
 * Avoids loading every system/custom template + JPEG just to render four cards.
 */
export async function getSelectedTemplatesByTypeForShop(
  shopDomain: string,
  documentTypes: DocumentType[],
): Promise<Array<{
  documentType: DocumentType;
  selected: TemplateListItem | null;
}> | null> {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const meta = Object.fromEntries(SYSTEM_TEMPLATES.map((t) => [t.code, t]));

  return Promise.all(
    documentTypes.map(async (documentType) => {
      const defaultId = defaultIdForType(store, documentType);
      if (!defaultId) {
        return { documentType, selected: null };
      }

      const template = await prisma.invoiceTemplate.findUnique({
        where: { id: defaultId },
      });
      if (
        !template ||
        !template.isActive ||
        (!template.isSystem && template.storeId !== store.id)
      ) {
        return { documentType, selected: null };
      }

      return {
        documentType,
        selected: mapTemplateListItem(template, store, meta, documentType),
      };
    }),
  );
}

export type TemplatesPanelPagination = {
  page: number;
  limit: number;
  totalSystem: number;
  totalCustom: number;
  hasMore: boolean;
  loadedSystem: number;
};

export async function getTemplatesPanelForShop(
  shopDomain: string,
  documentType: DocumentType,
  options?: { page?: number; limit?: number; skipEnsure?: boolean },
) {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(
    40,
    Math.max(1, options?.limit ?? SYSTEM_TEMPLATES_PAGE_SIZE),
  );

  if (!options?.skipEnsure) {
    await ensureSystemTemplates();
  }

  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const typeWhere = documentTypeWhere(documentType);
  const meta = Object.fromEntries(SYSTEM_TEMPLATES.map((t) => [t.code, t]));

  const [customTemplates, systemTotal, customTotal] = await Promise.all([
    page === 1
      ? prisma.invoiceTemplate.findMany({
          where: {
            storeId: store.id,
            isSystem: false,
            isActive: true,
            ...typeWhere,
          },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([] as InvoiceTemplate[]),
    prisma.invoiceTemplate.count({
      where: { isSystem: true, isActive: true, ...typeWhere },
    }),
    page === 1
      ? prisma.invoiceTemplate.count({
          where: {
            storeId: store.id,
            isSystem: false,
            isActive: true,
            ...typeWhere,
          },
        })
      : Promise.resolve(0),
  ]);

  const systemTemplates = await prisma.invoiceTemplate.findMany({
    where: { isSystem: true, isActive: true, ...typeWhere },
    orderBy: { name: "asc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  const customItems =
    page === 1
      ? customTemplates.map((t) =>
          mapTemplateListItem(t, store, meta, documentType),
        )
      : [];
  const systemItems = systemTemplates.map((t) =>
    mapTemplateListItem(t, store, meta, documentType),
  );

  const loadedSystem = (page - 1) * limit + systemItems.length;
  return {
    store,
    documentType,
    customItems,
    systemItems,
    pagination: {
      page,
      limit,
      totalSystem: systemTotal,
      totalCustom: page === 1 ? customTotal : 0,
      hasMore: loadedSystem < systemTotal,
      loadedSystem,
    } satisfies TemplatesPanelPagination,
  };
}

export async function getTemplateByIdForShop(
  shopDomain: string,
  templateId: string,
) {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const template = await prisma.invoiceTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template || !template.isActive) return null;

  if (!template.isSystem && template.storeId !== store.id) {
    return null;
  }

  const layout = asBaseLayoutCode(template.baseLayoutCode);
  return {
    store,
    template,
    config: resolveConfig(template, layout),
    documentType: asDocumentType(template.documentType),
  };
}

export async function createCustomTemplate(
  shopDomain: string,
  input: {
    name: string;
    baseLayoutCode: BaseLayoutCode;
    documentType?: DocumentType;
    sourceTemplateId?: string;
    sourceType?: "layout" | "code";
    liquidHtml?: string;
  },
) {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  let documentType = input.documentType ?? "tax_invoice";
  let baseConfig = getDefaultConfigForLayout(input.baseLayoutCode, documentType);
  let description = `Custom template based on ${input.baseLayoutCode}`;

  let sourceType: "layout" | "imported" | "code" = "layout";
  let customHtml: string | null = null;
  let customCss: string | null = null;
  let importMeta: Prisma.InputJsonValue | undefined;

  if (input.sourceTemplateId) {
    const source = await getTemplateByIdForShop(
      shopDomain,
      input.sourceTemplateId,
    );
    if (source) {
      documentType = source.documentType;
      baseConfig = structuredClone(source.config);
      description = source.template.description ?? description;
      sourceType = templateSourceKind(source.template);
      customHtml =
        typeof source.template.customHtml === "string"
          ? source.template.customHtml
          : null;
      customCss =
        typeof source.template.customCss === "string"
          ? source.template.customCss
          : null;
      if (source.template.importMeta != null) {
        importMeta = source.template.importMeta as Prisma.InputJsonValue;
      }
    }
  }

  if (input.sourceType === "code") {
    sourceType = "code";
    customHtml = typeof input.liquidHtml === "string" ? input.liquidHtml : "";
    customCss = "";
    description = "Custom HTML / Liquid template";
  }

  const branding = await getBrandingInputForShop(shopDomain);
  const config = mergeConfigWithBranding(baseConfig, branding, documentType);

  if (sourceType === "code" && !String(customHtml || "").trim()) {
    customHtml = buildLiquidFromConfig(
      config,
      documentType,
      input.baseLayoutCode,
    );
  }

  return prisma.invoiceTemplate.create({
    data: {
      code: customCode(store.id, input.baseLayoutCode, documentType),
      name: input.name.trim() || "Untitled template",
      description,
      baseLayoutCode: input.baseLayoutCode,
      config: config as unknown as Prisma.InputJsonValue,
      documentType,
      sourceType,
      customHtml,
      customCss,
      ...(importMeta !== undefined ? { importMeta } : {}),
      storeId: store.id,
      merchantId: store.merchantId,
      isSystem: false,
      isActive: true,
      version: 1,
    },
  });
}

export async function saveTemplateConfig(
  shopDomain: string,
  templateId: string,
  input: {
    name?: string;
    config: unknown;
    sourceType?: "layout" | "code";
    liquidHtml?: string;
    customCss?: string;
  },
) {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result || result.template.isSystem) return null;

  const parsed = enforceComplianceLocks(
    templateConfigSchema.parse({
      ...result.config,
      ...templateConfigSchema.partial().parse(input.config),
    }),
    result.documentType,
  );
  parsed.content = sanitizeTemplateConfigContent(parsed.content);
  if (parsed.translations) {
    parsed.translations = sanitizeTemplateTranslations(parsed.translations);
  }

  const currentKind = templateSourceKind(result.template);
  const nextKind =
    input.sourceType ?? (currentKind === "imported" ? "imported" : currentKind);

  const data: Prisma.InvoiceTemplateUpdateInput = {
    name: input.name?.trim() || result.template.name,
    config: parsed as unknown as Prisma.InputJsonValue,
  };

  if (nextKind === "code") {
    const liquid =
      (input.liquidHtml ?? "").trim() ||
      starterLiquidFor(result.documentType, null);
    data.sourceType = "code";
    data.customHtml = liquid;
    data.customCss = input.customCss ?? "";
  } else if (nextKind === "layout") {
    data.sourceType = "layout";
    data.customHtml = null;
    data.customCss = null;
  }

  return prisma.invoiceTemplate.update({
    where: { id: result.template.id },
    data,
  });
}

export async function saveTemplateAsNew(
  shopDomain: string,
  sourceTemplateId: string,
  input: { name: string; config: unknown },
) {
  const result = await getTemplateByIdForShop(shopDomain, sourceTemplateId);
  if (!result) return null;

  const store = result.store;
  const layout = asBaseLayoutCode(result.template.baseLayoutCode);

  const parsed = enforceComplianceLocks(
    templateConfigSchema.parse({
      ...result.config,
      ...templateConfigSchema.partial().parse(input.config),
    }),
    result.documentType,
  );
  parsed.content = sanitizeTemplateConfigContent(parsed.content);
  if (parsed.translations) {
    parsed.translations = sanitizeTemplateTranslations(parsed.translations);
  }

  const sourceKind = templateSourceKind(result.template);

  return prisma.invoiceTemplate.create({
    data: {
      code: customCode(store.id, layout, result.documentType),
      name: input.name.trim() || `${result.template.name} (copy)`,
      description:
        result.template.description ?? `Custom template based on ${layout}`,
      baseLayoutCode: layout,
      config: parsed as unknown as Prisma.InputJsonValue,
      documentType: result.documentType,
      sourceType: sourceKind,
      customHtml: result.template.customHtml ?? null,
      customCss: result.template.customCss ?? null,
      importMeta:
        result.template.importMeta != null
          ? (result.template.importMeta as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      storeId: store.id,
      merchantId: store.merchantId,
      isSystem: false,
      isActive: true,
      version: 1,
    },
  });
}

export async function duplicateTemplate(
  shopDomain: string,
  templateId: string,
) {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;

  const { store, template, config, documentType } = result;
  const layout = asBaseLayoutCode(template.baseLayoutCode);

  return prisma.invoiceTemplate.create({
    data: {
      code: customCode(store.id, layout, documentType),
      name: `${template.name} (copy)`,
      description: template.description,
      baseLayoutCode: layout,
      config: structuredClone(config) as unknown as Prisma.InputJsonValue,
      documentType,
      sourceType: templateSourceKind(template),
      customHtml: template.customHtml ?? null,
      customCss: template.customCss ?? null,
      importMeta:
        template.importMeta != null
          ? (template.importMeta as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      storeId: store.id,
      merchantId: store.merchantId,
      isSystem: false,
      isActive: true,
      version: 1,
    },
  });
}

async function systemFallbackId(code: string): Promise<string | null> {
  const fallback = await prisma.invoiceTemplate.findFirst({
    where: { isSystem: true, code, isActive: true },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export async function deleteCustomTemplate(
  shopDomain: string,
  templateId: string,
): Promise<boolean> {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result || result.template.isSystem) return false;

  await prisma.invoiceTemplate.update({
    where: { id: result.template.id },
    data: { isActive: false },
  });

  const storeUpdate: Prisma.StoreUpdateInput = {};

  if (result.store.defaultTemplateId === result.template.id) {
    const fallbackId = await systemFallbackId("modern");
    if (fallbackId) storeUpdate.defaultTemplateId = fallbackId;
  }
  if (result.store.defaultPackingSlipTemplateId === result.template.id) {
    const fallbackId = await systemFallbackId("packing-slip");
    if (fallbackId) storeUpdate.defaultPackingSlipTemplateId = fallbackId;
  }
  if (result.store.defaultCreditNoteTemplateId === result.template.id) {
    const fallbackId = await systemFallbackId("credit-note");
    if (fallbackId) storeUpdate.defaultCreditNoteTemplateId = fallbackId;
  }
  if (result.store.defaultRefundDocumentTemplateId === result.template.id) {
    const fallbackId = await systemFallbackId("refund-document");
    if (fallbackId) storeUpdate.defaultRefundDocumentTemplateId = fallbackId;
  }

  if (Object.keys(storeUpdate).length > 0) {
    await prisma.store.update({
      where: { id: result.store.id },
      data: storeUpdate,
    });
  }

  return true;
}

export async function setDefaultTemplate(
  shopDomain: string,
  templateId: string,
) {
  await ensureSystemTemplates();
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;

  const data: Prisma.StoreUpdateInput =
    result.documentType === "packing_slip"
      ? { defaultPackingSlipTemplateId: result.template.id }
      : result.documentType === "credit_note"
        ? { defaultCreditNoteTemplateId: result.template.id }
        : result.documentType === "refund_document"
          ? { defaultRefundDocumentTemplateId: result.template.id }
          : { defaultTemplateId: result.template.id };

  await prisma.store.update({
    where: { id: result.store.id },
    data,
  });

  return result.template;
}

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

/**
 * Merge + validate a client draft config against the saved template config.
 * Used by save and visual preview. Throws ZodError on invalid input.
 */
export function mergeDraftTemplateConfig(
  existing: TemplateConfig,
  draft: unknown,
  documentType: DocumentType,
): TemplateConfig {
  const parsed = enforceComplianceLocks(
    templateConfigSchema.parse({
      ...existing,
      ...templateConfigSchema.partial().parse(draft),
    }),
    documentType,
  );
  parsed.content = sanitizeTemplateConfigContent(parsed.content);
  if (parsed.translations) {
    parsed.translations = sanitizeTemplateTranslations(parsed.translations);
  }
  return parsed;
}

/**
 * Parse `configJson` from a form post. Returns null if missing/empty JSON.
 * Throws on invalid configuration (caller should reject save).
 */
export function parseConfigJsonFromForm(
  existing: TemplateConfig,
  configJson: unknown,
  documentType: DocumentType,
): TemplateConfig | null {
  if (configJson == null || configJson === "") return null;
  const raw =
    typeof configJson === "string" ? JSON.parse(configJson) : configJson;
  return mergeDraftTemplateConfig(existing, raw, documentType);
}

/** Blocking Liquid errors when saving from the code editor (old parity). */
export function blockingLiquidErrorsForEditor(
  check: LiquidValidation,
  editorMode: "code" | "visual",
): string[] {
  if (editorMode === "code") {
    return check.errors.filter((msg) =>
      /syntax|missing ">"|Unclosed|cannot be empty|too large/i.test(msg),
    );
  }
  return check.errors;
}

/**
 * Load Liquid source for the editor (old GET /templates/:id/source).
 */
export async function getTemplateLiquidSourceForShop(
  shopDomain: string,
  templateId: string,
  options: { starter?: boolean } = {},
): Promise<{
  liquidHtml: string;
  customCss: string;
  sourceType: "layout" | "imported" | "code";
  documentType: DocumentType;
} | null> {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;

  const sourceKind = templateSourceKind(result.template);
  const savedLiquid =
    typeof result.template.customHtml === "string"
      ? result.template.customHtml
      : "";
  const savedCss =
    typeof result.template.customCss === "string"
      ? result.template.customCss
      : "";
  const layout = asBaseLayoutCode(result.template.baseLayoutCode);

  let liquidHtml = "";
  if (options.starter) {
    liquidHtml = defaultLiquidSource(result.documentType);
  } else if (sourceKind === "imported") {
    liquidHtml = starterLiquidFor(result.documentType, savedLiquid || null);
  } else if (savedLiquid.trim()) {
    liquidHtml = savedLiquid;
  } else {
    liquidHtml = buildLiquidFromConfig(result.config, result.documentType, layout);
  }

  return {
    liquidHtml,
    customCss: options.starter ? "" : savedCss,
    sourceType: sourceKind === "imported" ? "imported" : "code",
    documentType: result.documentType,
  };
}

/**
 * Validate Liquid for a shop-owned template (old POST /validate).
 */
export async function validateTemplateLiquidForShop(
  shopDomain: string,
  templateId: string,
  liquidHtml: string,
): Promise<LiquidValidation | null> {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;
  return validateLiquidSource(liquidHtml, result.documentType);
}

/**
 * Config → Liquid sync (old POST /from-config).
 * Patches only changed groups when previousConfig is provided.
 */
export async function syncConfigToLiquidForShop(
  shopDomain: string,
  templateId: string,
  input: {
    config?: unknown;
    previousConfig?: unknown;
    liquidHtml?: string;
  },
): Promise<{ liquidHtml: string } | null> {
  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;

  let config = result.config;
  if (input.config) {
    config = mergeDraftTemplateConfig(
      result.config,
      input.config,
      result.documentType,
    );
  }

  let previousConfig: TemplateConfig | null = null;
  if (input.previousConfig) {
    try {
      previousConfig = templateConfigSchema.parse({
        ...result.config,
        ...templateConfigSchema.partial().parse(input.previousConfig),
      });
    } catch {
      previousConfig = result.config;
    }
  }

  const currentHtml =
    typeof input.liquidHtml === "string"
      ? input.liquidHtml
      : typeof result.template.customHtml === "string"
        ? result.template.customHtml
        : "";

  const keepInvoiceNumber = sourceHasInvoiceNumber(currentHtml);
  let liquidHtml = applyConfigToExistingLiquid(
    currentHtml,
    config,
    result.documentType,
    previousConfig,
  );
  if (!keepInvoiceNumber) {
    liquidHtml = stripInvoiceNumberOutputs(liquidHtml);
  }

  return { liquidHtml };
}

export type PreviewTemplateDraft = {
  config?: unknown;
  liquidHtml?: string;
  customCss?: string;
  sourceType?: "layout" | "code" | "imported";
};

/**
 * Old `attachSampleVerificationIfEnabled` — preview only shows a QR when the
 * checkbox is on and the document type supports verification (not packing slips).
 */
async function attachSampleVerificationIfEnabled(
  data: import("./template-render-engine.server").TemplateRenderInvoiceData,
  config: TemplateConfig,
  documentType: DocumentType,
): Promise<import("./template-render-engine.server").TemplateRenderInvoiceData> {
  const {
    buildSampleVerification,
    verificationKindFromDocumentType,
  } = await import("./verification.server");
  const next = { ...data };
  if (
    config.sections.qrCode?.visible &&
    verificationKindFromDocumentType(documentType)
  ) {
    next.verification = await buildSampleVerification(documentType);
  }
  return next;
}

/**
 * Raw template preview HTML (old `renderTemplatePreviewById`).
 * No A4 wrap / embed chrome — used by thumbnails and then wrapped for UI preview.
 */
export async function renderTemplatePreviewHtmlById(
  shopDomain: string,
  templateId: string,
  draftConfigOrDraft?: unknown | PreviewTemplateDraft,
): Promise<string | null> {
  const { renderDocumentHtml, sampleRenderDataForDocumentType } = await import(
    "./render.server"
  );

  const result = await getTemplateByIdForShop(shopDomain, templateId);
  if (!result) return null;

  const draft: PreviewTemplateDraft =
    draftConfigOrDraft &&
    typeof draftConfigOrDraft === "object" &&
    ("liquidHtml" in (draftConfigOrDraft as object) ||
      "sourceType" in (draftConfigOrDraft as object) ||
      "customCss" in (draftConfigOrDraft as object) ||
      "config" in (draftConfigOrDraft as object))
      ? (draftConfigOrDraft as PreviewTemplateDraft)
      : { config: draftConfigOrDraft };

  let config = result.config;
  if (draft.config !== undefined && draft.config !== null) {
    try {
      config = mergeDraftTemplateConfig(
        result.config,
        draft.config,
        result.documentType,
      );
    } catch {
      // Invalid draft → fall back to saved config (old preview parity).
    }
  }

  const savedKind = templateSourceKind(result.template);
  const kind = draft.sourceType ?? savedKind;
  const savedHtml =
    typeof result.template.customHtml === "string"
      ? result.template.customHtml
      : null;
  let customHtml =
    kind === "code"
      ? typeof draft.liquidHtml === "string"
        ? draft.liquidHtml
        : (savedHtml ?? "")
      : kind === "imported"
        ? savedHtml
        : null;
  // Code preview: patch Liquid from draft config so Style/Layout/Fields (colors,
  // columns, etc.) match the sidebar even when the client liquid is still stale
  // from the async from-config sync race (old editor synced before preview).
  if (
    kind === "code" &&
    typeof customHtml === "string" &&
    draft.config !== undefined &&
    draft.config !== null
  ) {
    customHtml = applyConfigToExistingLiquid(
      customHtml,
      config,
      result.documentType,
    );
  }
  const customCss =
    draft.customCss ??
    (typeof result.template.customCss === "string"
      ? result.template.customCss
      : null);

  const layout = asBaseLayoutCode(result.template.baseLayoutCode);
  const data = await attachSampleVerificationIfEnabled(
    sampleRenderDataForDocumentType(result.documentType),
    config,
    result.documentType,
  );
  // Old pintStrictForShop: compliance mode applies strict column locks on preview.
  const { pintStrictForShop } = await import("./compliance.server");
  const pintStrict = await pintStrictForShop(shopDomain);
  return renderDocumentHtml({
    baseLayoutCode: layout,
    documentType: result.documentType,
    config,
    data,
    branding: null,
    customHtml,
    sourceType: kind === "layout" ? "layout" : kind,
    customCss,
    renderOptions: { pintStrict },
  });
}

/**
 * Group 14 Phase C — template preview for the editor iframe.
 * Wraps raw preview HTML with A4 embed chrome.
 */
export async function previewTemplateVisualConfig(
  shopDomain: string,
  templateId: string,
  draftConfigOrDraft?: unknown | PreviewTemplateDraft,
): Promise<string | null> {
  const { wrapA4EmbedHtml } = await import("./document-preview.server");
  const html = await renderTemplatePreviewHtmlById(
    shopDomain,
    templateId,
    draftConfigOrDraft,
  );
  if (!html) return null;
  return wrapA4EmbedHtml(html);
}
