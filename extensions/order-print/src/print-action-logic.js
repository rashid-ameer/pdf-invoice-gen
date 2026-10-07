/**
 * Pure helpers for the Admin Print Action (Group 15 Phase C).
 * Kept free of Preact/Shopify globals so unit tests can import them.
 */

/** @typedef {'invoice' | 'packing_slip' | 'credit_note' | 'refund_document'} PrintDocType */

/**
 * Normalize Shopify Admin order GID or numeric id → digits only.
 * Matches Phase B `normalizeShopifyOrderId`.
 * @param {unknown} gidOrId
 * @returns {string | null}
 */
export function numericOrderId(gidOrId) {
  if (gidOrId == null) return null;
  const digits = String(gidOrId).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Collect selected print types in stable UI order (old parity).
 * @param {{
 *   invoice?: boolean;
 *   packingSlip?: boolean;
 *   creditNote?: boolean;
 *   refundDocument?: boolean;
 * }} selection
 * @returns {PrintDocType[]}
 */
export function collectPrintTypes(selection) {
  /** @type {PrintDocType[]} */
  const types = [];
  if (selection.invoice) types.push("invoice");
  if (selection.packingSlip) types.push("packing_slip");
  if (selection.creditNote) types.push("credit_note");
  if (selection.refundDocument) types.push("refund_document");
  return types;
}

/**
 * Default checkbox selection — Invoice on (old Print Action parity).
 */
export function defaultPrintSelection() {
  return {
    invoice: true,
    packingSlip: false,
    creditNote: false,
    refundDocument: false,
  };
}

/**
 * Build relative `/app/print` URL for s-admin-print-action `src`.
 * Uses URLSearchParams for encoding. Passes `types` + `token` (Phase A/B).
 *
 * @param {{
 *   orderId: string;
 *   types: PrintDocType[];
 *   token?: string | null;
 * }} opts
 * @returns {string | null} null when orderId missing or types empty
 */
export function buildPrintSrc(opts) {
  const orderId = String(opts.orderId || "").trim();
  const types = Array.isArray(opts.types) ? opts.types.filter(Boolean) : [];
  if (!orderId || types.length === 0) return null;

  const params = new URLSearchParams();
  params.set("orderId", orderId);
  params.set("types", types.join(","));
  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (token) params.set("token", token);

  return `/app/print?${params.toString()}`;
}

/**
 * Merchant-safe error messages — never include tokens/secrets.
 * @param {'no_order' | 'no_types' | 'no_token' | 'build_failed' | string} code
 * @returns {string}
 */
export function printActionErrorMessage(code) {
  switch (code) {
    case "no_order":
      return "No order selected. Open Print from an order details page.";
    case "no_types":
      return "Select at least one document to print.";
    case "no_token":
      return "Could not authenticate this print request. Refresh the page and try again.";
    case "build_failed":
      return "Unable to prepare the print preview. Try again.";
    default:
      return "Unable to prepare the print preview. Try again.";
  }
}
