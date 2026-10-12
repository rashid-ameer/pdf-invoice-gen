/** Group 13 Phase A — public customer-link tokens. Phase D UI/email reuse these helpers. */

import crypto from "node:crypto";
import type { CreditNote, Invoice, Store } from "@prisma/client";

import prisma from "../db.server";

/** Old: `LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000` */
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DISPLAY_TZ = "UTC";

export type CreditNotePublicDocumentType = "credit_note" | "refund_document";

export type PublicTokenKind = "inv" | "cn" | "rd";

type SignedPublicPayload = {
  /** Document id */
  i: string;
  /** Expiry epoch ms */
  e: number;
  /** Document kind */
  t: PublicTokenKind;
};

export type PublicAccessRecord = {
  tokenHash: string;
  token: string;
  expiresAt: string;
  issuedAt: string;
};

function getLinkSecret(): string {
  return (
    process.env.ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "dev-public-link-secret"
  );
}

function getAppBaseUrl(): string {
  const raw =
    process.env.SHOPIFY_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signPublicToken(payload: SignedPublicPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getLinkSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySignedPublicToken(token: string): SignedPublicPayload | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = crypto
    .createHmac("sha256", getLinkSecret())
    .update(body)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SignedPublicPayload;
    if (!payload?.i || typeof payload.e !== "number" || !payload.t) return null;
    if (payload.e <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function buildPublicInvoiceUrl(token: string): string {
  return `${getAppBaseUrl()}/public/invoices/${encodeURIComponent(token)}`;
}

function buildPublicCreditNoteUrl(
  token: string,
  documentType: CreditNotePublicDocumentType,
): string {
  const path =
    documentType === "refund_document" ? "refund-documents" : "credit-notes";
  return `${getAppBaseUrl()}/public/${path}/${encodeURIComponent(token)}`;
}

function accessField(
  documentType: CreditNotePublicDocumentType,
): "publicAccessCreditNote" | "publicAccessRefundDocument" {
  return documentType === "refund_document"
    ? "publicAccessRefundDocument"
    : "publicAccessCreditNote";
}

function parsePublicAccess(value: unknown): {
  token?: string;
  tokenHash?: string;
  expiresAt?: Date;
  issuedAt?: Date;
} | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const token = typeof raw.token === "string" ? raw.token : undefined;
  const tokenHash =
    typeof raw.tokenHash === "string" ? raw.tokenHash : undefined;
  const expiresAt = raw.expiresAt ? new Date(String(raw.expiresAt)) : undefined;
  const issuedAt = raw.issuedAt ? new Date(String(raw.issuedAt)) : undefined;
  return { token, tokenHash, expiresAt, issuedAt };
}

function toPublicAccessRecord(
  token: string,
  expiresAt: Date,
  issuedAt: Date,
): PublicAccessRecord {
  return {
    tokenHash: hashToken(token),
    token,
    expiresAt: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
  };
}

function normalizePublicToken(token: string): string {
  const raw = String(token || "").trim();
  if (!raw) return "";
  try {
    // Express usually decodes once; tolerate a single extra encode pass.
    let value = raw;
    if (value.includes("%")) {
      value = decodeURIComponent(value);
    }
    return value;
  } catch {
    return raw;
  }
}

function calendarDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Human-readable expiry for public document links (old parity). */
export function formatPublicLinkExpiry(
  expiresAt: Date,
  now = new Date(),
): string {
  const msLeft = expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return "Expired";

  const exact = expiresAt.toLocaleString("en-US", {
    timeZone: DISPLAY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  const expireDay = calendarDayKey(expiresAt);
  const today = calendarDayKey(now);
  const tomorrow = calendarDayKey(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );

  let relative: string;
  if (expireDay === today) {
    relative =
      hoursLeft <= 1
        ? "Expires today (less than 1 hour left)"
        : "Expires today";
  } else if (expireDay === tomorrow || daysLeft === 1) {
    relative = "Expires tomorrow";
  } else {
    relative = `Expires in ${daysLeft} days`;
  }

  return `${relative} · ${exact}`;
}

/**
 * Old resolve gate: store must exist and have a shopifyDomain.
 * Store.status is NOT checked (old parity).
 */
async function resolveStoreForDocument(
  storeId: string,
): Promise<Store | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.shopifyDomain) return null;
  return store;
}

/**
 * Issue (or reuse) a public invoice link.
 * Links are HMAC-signed so reopening admin does not invalidate a copied link.
 */
export async function issueInvoicePublicLink(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, publicAccess: true },
  });
  if (!invoice) return null;

  const now = Date.now();
  const access = parsePublicAccess(invoice.publicAccess);
  const existingExpiry = access?.expiresAt?.getTime() ?? 0;
  const existingToken = access?.token ?? "";

  if (existingToken && existingExpiry > now + 60_000) {
    const verified = verifySignedPublicToken(existingToken);
    if (verified && verified.t === "inv" && verified.i === invoice.id) {
      return {
        ok: true as const,
        url: buildPublicInvoiceUrl(existingToken),
        expiresAt: new Date(existingExpiry),
      };
    }
  }

  const expiresAt = new Date(now + LINK_TTL_MS);
  const issuedAt = new Date();
  const token = signPublicToken({
    i: invoice.id,
    e: expiresAt.getTime(),
    t: "inv",
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      publicAccess: toPublicAccessRecord(token, expiresAt, issuedAt),
    },
  });

  return {
    ok: true as const,
    url: buildPublicInvoiceUrl(token),
    expiresAt,
  };
}

export async function resolveInvoiceByPublicToken(token: string): Promise<{
  invoice: Invoice;
  shopDomain: string;
  expiresAt: Date;
} | null> {
  const normalized = normalizePublicToken(token);
  if (!normalized) return null;

  const signed = verifySignedPublicToken(normalized);
  if (signed?.t === "inv") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: signed.i },
    });
    if (!invoice) return null;
    const store = await resolveStoreForDocument(invoice.storeId);
    if (!store) return null;
    return {
      invoice,
      shopDomain: store.shopifyDomain,
      expiresAt: new Date(signed.e),
    };
  }

  // Legacy opaque tokens (hash lookup).
  const tokenHash = hashToken(normalized);
  const legacyId = await findInvoiceIdByLegacyTokenHash(tokenHash);
  if (!legacyId) return null;

  const invoice = await prisma.invoice.findUnique({ where: { id: legacyId } });
  if (!invoice) return null;

  const access = parsePublicAccess(invoice.publicAccess);
  if (!access?.expiresAt || access.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const store = await resolveStoreForDocument(invoice.storeId);
  if (!store) return null;

  return {
    invoice,
    shopDomain: store.shopifyDomain,
    expiresAt: access.expiresAt,
  };
}

export async function issueCreditNotePublicLink(
  creditNoteId: string,
  documentType: CreditNotePublicDocumentType,
) {
  const field = accessField(documentType);
  const kind: PublicTokenKind =
    documentType === "refund_document" ? "rd" : "cn";

  const creditNote = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      id: true,
      publicAccessCreditNote: true,
      publicAccessRefundDocument: true,
    },
  });
  if (!creditNote) return null;

  const access = parsePublicAccess(creditNote[field]);
  const now = Date.now();
  const existingExpiry = access?.expiresAt?.getTime() ?? 0;
  const existingToken = access?.token ?? "";

  if (existingToken && existingExpiry > now + 60_000) {
    const verified = verifySignedPublicToken(existingToken);
    if (verified && verified.t === kind && verified.i === creditNote.id) {
      return {
        ok: true as const,
        url: buildPublicCreditNoteUrl(existingToken, documentType),
        expiresAt: new Date(existingExpiry),
        documentType,
      };
    }
  }

  const expiresAt = new Date(now + LINK_TTL_MS);
  const issuedAt = new Date();
  const token = signPublicToken({
    i: creditNote.id,
    e: expiresAt.getTime(),
    t: kind,
  });

  await prisma.creditNote.update({
    where: { id: creditNoteId },
    data: {
      [field]: toPublicAccessRecord(token, expiresAt, issuedAt),
    },
  });

  return {
    ok: true as const,
    url: buildPublicCreditNoteUrl(token, documentType),
    expiresAt,
    documentType,
  };
}

export async function resolveCreditNoteByPublicToken(
  token: string,
  documentType: CreditNotePublicDocumentType,
): Promise<{
  creditNote: CreditNote;
  shopDomain: string;
  documentType: CreditNotePublicDocumentType;
  expiresAt: Date;
} | null> {
  const normalized = normalizePublicToken(token);
  if (!normalized) return null;

  const kind: PublicTokenKind =
    documentType === "refund_document" ? "rd" : "cn";
  const signed = verifySignedPublicToken(normalized);
  if (signed?.t === kind) {
    const creditNote = await prisma.creditNote.findUnique({
      where: { id: signed.i },
    });
    if (!creditNote) return null;
    const store = await resolveStoreForDocument(creditNote.storeId);
    if (!store) return null;
    return {
      creditNote,
      shopDomain: store.shopifyDomain,
      documentType,
      expiresAt: new Date(signed.e),
    };
  }

  const tokenHash = hashToken(normalized);
  const field = accessField(documentType);
  const legacyId = await findCreditNoteIdByLegacyTokenHash(tokenHash, field);
  if (!legacyId) return null;

  const creditNote = await prisma.creditNote.findUnique({
    where: { id: legacyId },
  });
  if (!creditNote) return null;

  const access = parsePublicAccess(creditNote[field]);
  if (!access?.expiresAt || access.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const store = await resolveStoreForDocument(creditNote.storeId);
  if (!store) return null;

  return {
    creditNote,
    shopDomain: store.shopifyDomain,
    documentType,
    expiresAt: access.expiresAt,
  };
}

/** Test/helper: decode signed token without DB lookup (null if invalid/expired). */
export function inspectSignedPublicToken(
  token: string,
): SignedPublicPayload | null {
  return verifySignedPublicToken(token);
}

/** Test/helper: SHA-256 hex of a token (old `hashToken`). */
export function hashPublicToken(token: string): string {
  return hashToken(token);
}

async function findInvoiceIdByLegacyTokenHash(
  tokenHash: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Invoice"
    WHERE "publicAccess"->>'tokenHash' = ${tokenHash}
      AND ("publicAccess"->>'expiresAt') > ${new Date().toISOString()}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function findCreditNoteIdByLegacyTokenHash(
  tokenHash: string,
  field: "publicAccessCreditNote" | "publicAccessRefundDocument",
): Promise<string | null> {
  // Column name is fixed to one of two known Prisma fields (not user input).
  if (field === "publicAccessRefundDocument") {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "CreditNote"
      WHERE "publicAccessRefundDocument"->>'tokenHash' = ${tokenHash}
        AND ("publicAccessRefundDocument"->>'expiresAt') > ${new Date().toISOString()}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "CreditNote"
    WHERE "publicAccessCreditNote"->>'tokenHash' = ${tokenHash}
      AND ("publicAccessCreditNote"->>'expiresAt') > ${new Date().toISOString()}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Shop-scoped issue for admin Copy-link / email resolver.
 * Verifies the document belongs to the authenticated shop before issuing.
 */
export async function issueInvoicePublicLinkForShop(
  shopDomain: string,
  invoiceId: string,
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!store) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, storeId: store.id },
    select: { id: true },
  });
  if (!invoice) return null;

  return issueInvoicePublicLink(invoice.id);
}

export async function issueCreditNotePublicLinkForShop(
  shopDomain: string,
  creditNoteId: string,
  documentType: CreditNotePublicDocumentType,
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!store) return null;

  const creditNote = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, storeId: store.id },
    select: { id: true },
  });
  if (!creditNote) return null;

  return issueCreditNotePublicLink(creditNote.id, documentType);
}
