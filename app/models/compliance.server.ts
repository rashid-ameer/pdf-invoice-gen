/**
 * Group 16 — Compliance readiness, mode, ASP connect/disconnect.
 * Port of uae-invoiceing-app/server/services/compliance.service.ts.
 */
import type { LegalEntity, Store } from "@prisma/client";

import prisma from "../db.server";
import type { Address, InvoiceMode } from "../types/index";
import { encryptSecret } from "../utils/token-crypto";

export type ComplianceCheckKey =
  | "legalEntity"
  | "vatRegistered"
  | "sellerTrn"
  | "sellerTin"
  | "sellerContact"
  | "sellerAddress"
  | "aspConnected";

export type ComplianceCheckItem = {
  key: ComplianceCheckKey;
  label: string;
  detail: string;
  ok: boolean;
  requiredForCompliance: boolean;
};

export type ComplianceReadiness = {
  score: number;
  ready: boolean;
  checks: ComplianceCheckItem[];
  blockers: string[];
};

export type CompliancePageData = {
  invoiceMode: InvoiceMode;
  complianceReady: boolean;
  readiness: ComplianceReadiness;
  asp: {
    connected: boolean;
    providerName: string;
    providerCode: string;
    participantId: string;
    connectedAt: string | null;
    status: string;
  };
  legalEntity: {
    legalName: string;
    trn: string;
    tin: string;
    vatStatus: string;
  } | null;
};

type LegalEntityLike = {
  legalName?: string | null;
  trn?: string | null;
  tin?: string | null;
  vatStatus?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  emirate?: string | null;
  address?: Address | null;
} | null;

function asAddress(value: unknown): Address {
  if (!value || typeof value !== "object") return {};
  return value as Address;
}

async function getActiveStore(shopDomain: string): Promise<Store | null> {
  return prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
}

async function loadStoreContext(shopDomain: string) {
  const store = await getActiveStore(shopDomain);
  if (!store) return null;

  const legalEntity = store.defaultLegalEntityId
    ? await prisma.legalEntity.findUnique({
        where: { id: store.defaultLegalEntityId },
      })
    : null;

  let aspConnection = null;
  let aspProvider = null;
  if (store.aspConnectionId) {
    aspConnection = await prisma.aspConnection.findUnique({
      where: { id: store.aspConnectionId },
    });
    if (aspConnection?.providerId) {
      aspProvider = await prisma.aspProvider.findUnique({
        where: { id: aspConnection.providerId },
      });
    }
  }

  return { store, legalEntity, aspConnection, aspProvider };
}

export function buildComplianceReadiness(input: {
  legalEntity: LegalEntityLike;
  aspConnected: boolean;
}): ComplianceReadiness {
  const le = input.legalEntity;
  const vatRegistered = le?.vatStatus !== "not_registered";
  const address = le?.address ?? null;
  const checks: ComplianceCheckItem[] = [
    {
      key: "legalEntity",
      label: "Company profile",
      detail: "Legal name and registered seller details saved in Setup.",
      ok: Boolean(le?.legalName?.trim()),
      requiredForCompliance: true,
    },
    {
      key: "vatRegistered",
      label: "VAT registration",
      detail: "Business marked as VAT or sales tax registered.",
      ok: Boolean(le && vatRegistered),
      requiredForCompliance: true,
    },
    {
      key: "sellerTrn",
      label: "Seller tax ID",
      detail: "Tax registration number on the seller profile.",
      ok: Boolean(le?.trn?.trim()),
      requiredForCompliance: true,
    },
    {
      key: "sellerTin",
      label: "Seller TIN (Peppol ID)",
      detail: "Electronic invoicing routing identifier.",
      ok: Boolean(le?.tin?.trim()),
      requiredForCompliance: true,
    },
    {
      key: "sellerContact",
      label: "Business contact",
      detail:
        "Business email and phone on file for structured e-invoices.",
      ok: Boolean(le?.businessEmail?.trim() && le?.businessPhone?.trim()),
      requiredForCompliance: true,
    },
    {
      key: "sellerAddress",
      label: "Registered address",
      detail: "Address line, city, and country for the seller block.",
      ok: Boolean(
        address?.line1?.trim() &&
          address?.city?.trim() &&
          address?.country?.trim(),
      ),
      requiredForCompliance: true,
    },
    {
      key: "aspConnected",
      label: "ASP connection",
      detail:
        "Accredited Service Provider credentials linked for e-invoice submission.",
      ok: input.aspConnected,
      requiredForCompliance: true,
    },
  ];

  const required = checks.filter((c) => c.requiredForCompliance);
  const passed = required.filter((c) => c.ok).length;
  const score = required.length
    ? Math.round((passed / required.length) * 100)
    : 0;
  const blockers = required.filter((c) => !c.ok).map((c) => c.label);

  return {
    score,
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}

function legalEntityForReadiness(
  legalEntity: LegalEntity | null,
): LegalEntityLike {
  if (!legalEntity) return null;
  return {
    legalName: legalEntity.legalName,
    trn: legalEntity.trn,
    tin: legalEntity.tin,
    vatStatus: legalEntity.vatStatus,
    businessEmail: legalEntity.businessEmail,
    businessPhone: legalEntity.businessPhone,
    emirate: legalEntity.emirate,
    address: asAddress(legalEntity.address),
  };
}

export async function getComplianceReadiness(
  shopDomain: string,
): Promise<ComplianceReadiness | null> {
  const ctx = await loadStoreContext(shopDomain);
  if (!ctx) return null;
  const aspConnected =
    Boolean(ctx.aspConnection) && ctx.aspConnection?.status === "connected";
  return buildComplianceReadiness({
    legalEntity: legalEntityForReadiness(ctx.legalEntity),
    aspConnected,
  });
}

export async function getCompliancePageData(
  shopDomain: string,
): Promise<CompliancePageData | null> {
  const ctx = await loadStoreContext(shopDomain);
  if (!ctx) return null;

  const { store, legalEntity, aspConnection, aspProvider } = ctx;
  const aspConnected = Boolean(
    aspConnection && aspConnection.status === "connected",
  );
  const readiness = buildComplianceReadiness({
    legalEntity: legalEntityForReadiness(legalEntity),
    aspConnected,
  });

  return {
    invoiceMode:
      store.invoiceMode === "compliance" ? "compliance" : "standard",
    complianceReady: Boolean(store.complianceReady),
    readiness,
    asp: {
      connected: aspConnected,
      providerName: aspProvider?.name ?? "Storecove",
      providerCode: aspProvider?.code ?? "storecove",
      participantId: aspConnection?.participantId ?? legalEntity?.tin ?? "",
      connectedAt: aspConnection?.connectedAt
        ? aspConnection.connectedAt.toISOString()
        : null,
      status: aspConnection?.status ?? "disconnected",
    },
    legalEntity: legalEntity
      ? {
          legalName: legalEntity.legalName ?? "",
          trn: legalEntity.trn ?? "",
          tin: legalEntity.tin ?? "",
          vatStatus: legalEntity.vatStatus ?? "registered",
        }
      : null,
  };
}

async function ensureStorecoveProvider() {
  const existing = await prisma.aspProvider.findUnique({
    where: { code: "storecove" },
  });
  if (existing) return existing;
  return prisma.aspProvider.create({
    data: {
      code: "storecove",
      name: "Storecove",
      status: "active",
      capabilities: [
        "submit_invoice",
        "submit_credit_note",
        "webhooks",
        "participant_lookup",
      ],
      apiVersion: "v2",
    },
  });
}

export async function connectStoreAsp(
  shopDomain: string,
  input: { apiKey: string; participantId?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 8) {
    return {
      ok: false,
      error: "Enter a valid ASP API key (at least 8 characters).",
    };
  }

  const ctx = await loadStoreContext(shopDomain);
  if (!ctx) return { ok: false, error: "Store not found." };
  const { store, legalEntity } = ctx;
  if (!legalEntity) {
    return {
      ok: false,
      error: "Complete company setup before connecting an ASP.",
    };
  }

  const participantId = (
    input.participantId?.trim() ||
    legalEntity.tin ||
    ""
  ).trim();
  if (!participantId) {
    return {
      ok: false,
      error:
        "Participant ID (TIN) is required. Add it in Setup or enter it here.",
    };
  }

  const provider = await ensureStorecoveProvider();
  const encryptedKey = encryptSecret(apiKey)!;

  if (!store.aspConnectionId) {
    const connection = await prisma.aspConnection.create({
      data: {
        legalEntityId: legalEntity.id,
        providerId: provider.id,
        status: "connected",
        credentialsRef: encryptedKey,
        participantId,
        endpointScheme: "0088",
        connectedAt: new Date(),
      },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { aspConnectionId: connection.id },
    });
  } else {
    await prisma.aspConnection.update({
      where: { id: store.aspConnectionId },
      data: {
        legalEntityId: legalEntity.id,
        providerId: provider.id,
        status: "connected",
        credentialsRef: encryptedKey,
        participantId,
        endpointScheme: "0235",
        connectedAt: new Date(),
      },
    });
  }

  console.log(
    `[compliance] ASP connected for ${shopDomain} (participant ${participantId})`,
  );
  return { ok: true };
}

export async function disconnectStoreAsp(
  shopDomain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await getActiveStore(shopDomain);
  if (!store) return { ok: false, error: "Store not found." };

  if (store.invoiceMode === "compliance") {
    return {
      ok: false,
      error: "Switch to Standard mode before disconnecting the ASP.",
    };
  }

  if (store.aspConnectionId) {
    await prisma.aspConnection.update({
      where: { id: store.aspConnectionId },
      data: {
        status: "disconnected",
        credentialsRef: null,
      },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: {
        aspConnectionId: null,
        complianceReady: false,
      },
    });
  }

  console.log(`[compliance] ASP disconnected for ${shopDomain}`);
  return { ok: true };
}

export async function setInvoiceMode(
  shopDomain: string,
  mode: InvoiceMode,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await getActiveStore(shopDomain);
  if (!store) return { ok: false, error: "Store not found." };

  if (mode === "compliance") {
    const readiness = await getComplianceReadiness(shopDomain);
    if (!readiness?.ready) {
      return {
        ok: false,
        error: `Complete compliance readiness first: ${readiness?.blockers.join(", ") ?? "missing requirements"}.`,
      };
    }
    await prisma.store.update({
      where: { id: store.id },
      data: {
        invoiceMode: "compliance",
        complianceReady: true,
      },
    });
  } else {
    await prisma.store.update({
      where: { id: store.id },
      data: { invoiceMode: "standard" },
    });
  }

  console.log(`[compliance] invoice mode set to ${mode} for ${shopDomain}`);
  return { ok: true };
}

/** Whether template preview / render should apply pintStrict locks for this shop. */
export async function pintStrictForShop(shopDomain: string): Promise<boolean> {
  const store = await getActiveStore(shopDomain);
  return store?.invoiceMode === "compliance";
}
