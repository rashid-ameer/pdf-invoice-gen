/**
 * Group 13 Phase C — integrity hash, verification HMAC, QR payloads.
 *
 * Port of `uae-invoiceing-app/server/services/invoice-verification.service.ts`.
 * QR HTML helper remains in `verification-qr.server.ts` (Group 7 reuse).
 */

import crypto from "node:crypto";
import QRCode from "qrcode";
import type { CreditNote, Invoice } from "@prisma/client";

import prisma from "../db.server";
import { DEFAULT_CURRENCY } from "../constants/app";
import type { DocumentType } from "../types/index";
import type { DocumentVerificationPayload } from "./verification-qr.server";

export type { DocumentVerificationPayload };
export { buildVerificationQrHtml } from "./verification-qr.server";

export type VerificationDocumentKind =
  | "invoice"
  | "credit_note"
  | "refund_document";

export type IntegrityDocument = {
  invoiceNumber?: string;
  creditNoteNumber?: string;
  issueDate?: Date;
  currency?: string;
  seller?: {
    legalName?: string | null;
    trn?: string | null;
  };
  buyer?: { name?: string | null };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
    vatRate?: number;
    vatAmount: number;
    lineTotal: number;
  }>;
  totals: {
    subtotal: number;
    discount?: number;
    vatTotal: number;
    shipping?: number;
    grandTotal: number;
  };
};

type StoredVerification = {
  integrityHash?: string;
  sealedAt?: string;
};

function signingSecret(): string {
  return (
    process.env.ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "dev-verification-secret"
  );
}

function getAppBaseUrl(): string {
  const raw =
    process.env.SHOPIFY_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function documentNumber(
  doc: IntegrityDocument,
  kind: VerificationDocumentKind,
): string {
  if (kind === "invoice") return doc.invoiceNumber ?? "";
  return doc.creditNoteNumber ?? doc.invoiceNumber ?? "";
}

function roundMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseStoredVerification(value: unknown): StoredVerification | null {
  if (!value || typeof value !== "object") return null;
  return value as StoredVerification;
}

/** Normalize Prisma Invoice/CreditNote JSON into the integrity payload shape. */
export function toIntegrityDocument(
  doc: Pick<
    Invoice | CreditNote,
    "issueDate" | "currency" | "seller" | "buyer" | "lineItems" | "totals"
  > & {
    invoiceNumber?: string;
    creditNoteNumber?: string;
  },
): IntegrityDocument {
  const seller = (doc.seller ?? {}) as {
    legalName?: string | null;
    trn?: string | null;
  };
  const buyer = (doc.buyer ?? {}) as { name?: string | null };
  const rawLines = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const totals = (doc.totals ?? {}) as Record<string, unknown>;

  return {
    invoiceNumber: doc.invoiceNumber,
    creditNoteNumber: doc.creditNoteNumber,
    issueDate: doc.issueDate,
    currency: doc.currency ?? undefined,
    seller: {
      legalName: seller.legalName ?? null,
      trn: seller.trn ?? null,
    },
    buyer: { name: buyer.name ?? null },
    lineItems: rawLines.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        description: String(row.description ?? ""),
        quantity: Number(row.quantity ?? 0),
        unitPrice: Number(row.unitPrice ?? 0),
        discount: Number(row.discount ?? 0),
        vatRate: Number(row.vatRate ?? 0),
        vatAmount: Number(row.vatAmount ?? 0),
        lineTotal: Number(row.lineTotal ?? 0),
      };
    }),
    totals: {
      subtotal: Number(totals.subtotal ?? 0),
      discount: Number(totals.discount ?? 0),
      vatTotal: Number(totals.vatTotal ?? 0),
      shipping: Number(totals.shipping ?? 0),
      grandTotal: Number(totals.grandTotal ?? 0),
    },
  };
}

export function computeIntegrityHash(
  doc: IntegrityDocument,
  kind: VerificationDocumentKind,
): string {
  const payload = {
    kind,
    documentNumber: documentNumber(doc, kind),
    issueDate: doc.issueDate
      ? new Date(doc.issueDate).toISOString().slice(0, 10)
      : "",
    currency: doc.currency ?? DEFAULT_CURRENCY,
    sellerTrn: doc.seller?.trn ?? "",
    sellerName: doc.seller?.legalName ?? "",
    buyerName: doc.buyer?.name ?? "",
    lineItems: doc.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      discount: roundMoney(item.discount ?? 0),
      vatRate: item.vatRate ?? 0,
      vatAmount: roundMoney(item.vatAmount),
      lineTotal: roundMoney(item.lineTotal),
    })),
    totals: {
      subtotal: roundMoney(doc.totals.subtotal),
      discount: roundMoney(doc.totals.discount ?? 0),
      vatTotal: roundMoney(doc.totals.vatTotal),
      shipping: roundMoney(doc.totals.shipping ?? 0),
      grandTotal: roundMoney(doc.totals.grandTotal),
    },
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function integrityDisplayCode(integrityHash: string): string {
  return integrityHash.slice(0, 8).toUpperCase();
}

export function signVerificationUrl(
  documentId: string,
  kind: VerificationDocumentKind,
): string {
  const mac = crypto
    .createHmac("sha256", signingSecret())
    .update(`${kind}:${documentId}`)
    .digest("base64url");
  return mac.slice(0, 22);
}

export function verifySignature(
  documentId: string,
  kind: VerificationDocumentKind,
  signature: string,
): boolean {
  const expected = signVerificationUrl(documentId, kind);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || "").trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyPath(kind: VerificationDocumentKind): string {
  if (kind === "credit_note") return "credit-notes";
  if (kind === "refund_document") return "refund-documents";
  return "invoices";
}

export function buildVerifyUrl(
  documentId: string,
  kind: VerificationDocumentKind,
): string {
  const base = getAppBaseUrl();
  const signature = signVerificationUrl(documentId, kind);
  return `${base}/verify/${verifyPath(kind)}/${encodeURIComponent(documentId)}/${encodeURIComponent(signature)}`;
}

export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 192,
    errorCorrectionLevel: "M",
  });
}

async function buildPayload(
  documentId: string,
  kind: VerificationDocumentKind,
  integrityHash: string,
): Promise<DocumentVerificationPayload> {
  const verifyUrl = buildVerifyUrl(documentId, kind);
  const qrDataUrl = await generateQrDataUrl(verifyUrl);
  return {
    qrDataUrl,
    verifyUrl,
    integrityCode: integrityDisplayCode(integrityHash),
  };
}

export async function ensureInvoiceIntegrityHash(
  invoiceId: string,
): Promise<string | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;

  const hash = computeIntegrityHash(toIntegrityDocument(invoice), "invoice");
  const stored = parseStoredVerification(invoice.verification);
  if (!stored?.integrityHash) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        verification: {
          integrityHash: hash,
          sealedAt: new Date().toISOString(),
        },
      },
    });
    return hash;
  }
  return stored.integrityHash;
}

export async function ensureCreditNoteIntegrityHash(
  creditNoteId: string,
  kind: VerificationDocumentKind,
): Promise<string | null> {
  const creditNote = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  if (!creditNote) return null;

  const hash = computeIntegrityHash(toIntegrityDocument(creditNote), kind);
  const stored = parseStoredVerification(creditNote.verification);
  if (!stored?.integrityHash) {
    await prisma.creditNote.update({
      where: { id: creditNoteId },
      data: {
        verification: {
          integrityHash: hash,
          sealedAt: new Date().toISOString(),
        },
      },
    });
    return hash;
  }
  return stored.integrityHash;
}

export async function buildInvoiceVerification(
  invoiceId: string,
): Promise<DocumentVerificationPayload | null> {
  const hash = await ensureInvoiceIntegrityHash(invoiceId);
  if (!hash) return null;
  return buildPayload(invoiceId, "invoice", hash);
}

export async function buildCreditNoteVerification(
  creditNoteId: string,
  kind: "credit_note" | "refund_document",
): Promise<DocumentVerificationPayload | null> {
  const hash = await ensureCreditNoteIntegrityHash(creditNoteId, kind);
  if (!hash) return null;
  return buildPayload(creditNoteId, kind, hash);
}

/** Preview-only sample QR (no `/verify/sample` production route). */
export async function buildSampleVerification(
  documentType: DocumentType = "tax_invoice",
): Promise<DocumentVerificationPayload> {
  const kind: VerificationDocumentKind =
    documentType === "credit_note"
      ? "credit_note"
      : documentType === "refund_document"
        ? "refund_document"
        : "invoice";
  const base = getAppBaseUrl();
  const verifyUrl = `${base}/verify/sample?type=${kind}`;
  const qrDataUrl = await generateQrDataUrl(verifyUrl);
  return {
    qrDataUrl,
    verifyUrl,
    integrityCode: "SAMPLE01",
  };
}

export type VerificationResult =
  | { ok: false; reason: "invalid_link" | "not_found" }
  | {
      ok: true;
      authentic: boolean;
      tampered: boolean;
      kind: VerificationDocumentKind;
      documentNumber: string;
      issueDate: string;
      currency: string;
      sellerName: string;
      sellerTrn: string;
      buyerName: string;
      grandTotal: string;
      integrityCode: string;
      storeName: string;
      status: string;
    };

function formatVerifyDate(date?: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatVerifyAmount(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

export async function verifyInvoiceDocument(
  invoiceId: string,
  signature: string,
): Promise<VerificationResult> {
  if (!verifySignature(invoiceId, "invoice", signature)) {
    return { ok: false, reason: "invalid_link" };
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, reason: "not_found" };

  const store = await prisma.store.findUnique({
    where: { id: invoice.storeId },
  });
  const integrity = toIntegrityDocument(invoice);
  const currentHash = computeIntegrityHash(integrity, "invoice");
  const storedHash =
    parseStoredVerification(invoice.verification)?.integrityHash ?? "";
  const tampered = Boolean(storedHash && storedHash !== currentHash);

  return {
    ok: true,
    authentic: !tampered,
    tampered,
    kind: "invoice",
    documentNumber: invoice.invoiceNumber,
    issueDate: formatVerifyDate(invoice.issueDate),
    currency: invoice.currency ?? DEFAULT_CURRENCY,
    sellerName: integrity.seller?.legalName ?? "—",
    sellerTrn: integrity.seller?.trn ?? "—",
    buyerName: integrity.buyer?.name ?? "—",
    grandTotal: formatVerifyAmount(
      integrity.totals.grandTotal,
      invoice.currency ?? DEFAULT_CURRENCY,
    ),
    integrityCode: integrityDisplayCode(storedHash || currentHash),
    storeName: store?.shopifyDomain ?? "Merchant",
    status: invoice.status ?? "generated",
  };
}

export async function verifyCreditNoteDocument(
  creditNoteId: string,
  signature: string,
  kind: "credit_note" | "refund_document",
): Promise<VerificationResult> {
  if (!verifySignature(creditNoteId, kind, signature)) {
    return { ok: false, reason: "invalid_link" };
  }

  const creditNote = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  if (!creditNote) return { ok: false, reason: "not_found" };

  const store = await prisma.store.findUnique({
    where: { id: creditNote.storeId },
  });
  const integrity = toIntegrityDocument(creditNote);
  const currentHash = computeIntegrityHash(integrity, kind);
  const storedHash =
    parseStoredVerification(creditNote.verification)?.integrityHash ?? "";
  const tampered = Boolean(storedHash && storedHash !== currentHash);

  return {
    ok: true,
    authentic: !tampered,
    tampered,
    kind,
    documentNumber: creditNote.creditNoteNumber,
    issueDate: formatVerifyDate(creditNote.issueDate),
    currency: creditNote.currency ?? DEFAULT_CURRENCY,
    sellerName: integrity.seller?.legalName ?? "—",
    sellerTrn: integrity.seller?.trn ?? "—",
    buyerName: integrity.buyer?.name ?? "—",
    grandTotal: formatVerifyAmount(
      integrity.totals.grandTotal,
      creditNote.currency ?? DEFAULT_CURRENCY,
    ),
    integrityCode: integrityDisplayCode(storedHash || currentHash),
    storeName: store?.shopifyDomain ?? "Merchant",
    status: creditNote.status ?? "generated",
  };
}

export function verificationKindFromDocumentType(
  documentType: DocumentType,
): VerificationDocumentKind | null {
  if (documentType === "tax_invoice") return "invoice";
  if (documentType === "credit_note") return "credit_note";
  if (documentType === "refund_document") return "refund_document";
  return null;
}
