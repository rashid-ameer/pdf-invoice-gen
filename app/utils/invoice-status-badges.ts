/**
 * Centralized Shopify badge tone mappings for the Invoices index table.
 *
 * Sources:
 * - Prisma Invoice.status / Invoice.financialStatus (Group 8)
 * - normalizeFinancialStatus + PAYMENT_STATUS_FILTER_OPTIONS (Group 9)
 * - Shopify Badge + visual-design semantics:
 *   success = positive/completed
 *   caution = advisory/incomplete/needs attention
 *   warning = important warning
 *   critical = urgent/error/destructive
 *   info = informational
 *   neutral = general status without stronger meaning
 */

export type ShopifyBadgeTone =
  | "success"
  | "caution"
  | "warning"
  | "critical"
  | "info"
  | "neutral";

/** Exact Invoice.status values used by Group 8/9 (do not invent). */
export const INVOICE_DOCUMENT_STATUSES = [
  "draft",
  "generated",
  "ready",
  "downloaded",
  "submitted",
  "accepted",
  "rejected",
  "pending",
  "delivered",
  "failed",
] as const;

export type InvoiceDocumentStatus = (typeof INVOICE_DOCUMENT_STATUSES)[number];

/**
 * Payment status (Invoice.financialStatus) → badge tone
 * - paid → success — payment completed
 * - pending → caution — incomplete / awaiting payment
 * - authorized → info — funds held, not captured
 * - partially_paid → caution — incomplete payment
 * - partially_refunded → warning — money partially returned
 * - refunded → warning — money returned
 * - voided → critical — cancelled / destructive outcome
 * - expired → neutral — ended without stronger action
 */
const PAYMENT_STATUS_TONES: Record<string, ShopifyBadgeTone> = {
  paid: "success",
  pending: "caution",
  authorized: "info",
  partially_paid: "caution",
  partially_refunded: "warning",
  refunded: "warning",
  voided: "critical",
  expired: "neutral",
};

/**
 * Invoice status (Invoice.status document lifecycle) → badge tone
 * - draft → neutral — not yet processed
 * - generated → success — successfully created
 * - ready → info — ready for next step
 * - downloaded → success — merchant downloaded
 * - delivered → success — delivered
 * - submitted → info — submitted (e.g. compliance path)
 * - accepted → success — accepted
 * - pending → caution — waiting / incomplete
 * - rejected → critical — rejected
 * - failed → critical — failed
 */
const INVOICE_STATUS_TONES: Record<string, ShopifyBadgeTone> = {
  draft: "neutral",
  generated: "success",
  ready: "info",
  downloaded: "success",
  delivered: "success",
  submitted: "info",
  accepted: "success",
  pending: "caution",
  rejected: "critical",
  failed: "critical",
};

export function paymentStatusBadgeTone(
  financialStatus: string | null | undefined,
): ShopifyBadgeTone {
  const key = (financialStatus ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) return "neutral";
  return PAYMENT_STATUS_TONES[key] ?? "neutral";
}

export function invoiceStatusBadgeTone(
  status: string | null | undefined,
): ShopifyBadgeTone {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return "neutral";
  return INVOICE_STATUS_TONES[key] ?? "neutral";
}

export function formatInvoiceStatusLabel(status: string): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}
