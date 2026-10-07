/**
 * Pure helpers for the Order Documents Block (Group 15 Phase D).
 */

/**
 * Normalize Shopify Admin order GID or numeric id → digits only (Phase B).
 * @param {unknown} gidOrId
 * @returns {string | null}
 */
export function numericOrderId(gidOrId) {
  if (gidOrId == null) return null;
  const digits = String(gidOrId).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * @param {string} orderId
 * @returns {string}
 */
export function documentsSummaryPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/documents`;
}

/**
 * @param {string} orderId
 * @param {string} [token]
 * @returns {string}
 */
export function invoicePreviewPath(orderId, token) {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const qs = params.toString();
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/preview${
    qs ? `?${qs}` : ""
  }`;
}

/**
 * @param {string} orderId
 * @returns {string}
 */
export function invoiceEmailPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/email`;
}

/**
 * @param {string} orderId
 * @returns {string}
 */
export function invoiceCustomerLinkPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/customer-link`;
}

/**
 * Parse Phase B documents summary JSON into UI fields.
 * @param {unknown} json
 */
export function parseDocumentsSummary(json) {
  if (!json || typeof json !== "object") {
    return {
      ok: false,
      hasInvoice: false,
      invoiceNumber: "",
      invoiceStatus: "",
      creditNotesCount: 0,
      error: "Invalid response",
    };
  }
  const body = /** @type {Record<string, unknown>} */ (json);
  if (body.ok === false) {
    return {
      ok: false,
      hasInvoice: false,
      invoiceNumber: "",
      invoiceStatus: "",
      creditNotesCount: 0,
      error:
        typeof body.error === "string" ? body.error : "Failed to load documents",
    };
  }

  const inv =
    body.invoice && typeof body.invoice === "object"
      ? /** @type {Record<string, unknown>} */ (body.invoice)
      : null;

  const creditNotesCount =
    typeof body.creditNotesCount === "number"
      ? body.creditNotesCount
      : Array.isArray(body.creditNotes)
        ? body.creditNotes.length
        : 0;

  if (!inv) {
    return {
      ok: true,
      hasInvoice: false,
      invoiceNumber: "",
      invoiceStatus: "",
      creditNotesCount,
      error: "",
    };
  }

  return {
    ok: true,
    hasInvoice: true,
    invoiceNumber: String(inv.invoiceNumber || ""),
    invoiceStatus: String(inv.status || ""),
    creditNotesCount,
    error: "",
  };
}

/**
 * Merchant-safe error text — never include tokens/secrets.
 * @param {number | string} statusOrCode
 * @param {string} [fallback]
 */
export function blockSafeErrorMessage(statusOrCode, fallback) {
  const status = Number(statusOrCode);
  if (status === 401) {
    return "Could not authenticate. Refresh the page and try again.";
  }
  if (status === 404) {
    return "No invoice found for this order.";
  }
  if (status === 502) {
    return fallback || "The request failed. Try again.";
  }
  if (typeof fallback === "string" && fallback.trim()) {
    // Strip anything that looks like a token/JWT fragment
    if (/eyJ[A-Za-z0-9_-]+\.|Bearer\s|shpat_/i.test(fallback)) {
      return "Something went wrong. Try again.";
    }
    return fallback;
  }
  return "Something went wrong. Try again.";
}

/**
 * Credit-note summary line for the block (informational only).
 * @param {number} count
 * @returns {string}
 */
export function creditNotesLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1 ? "1 credit note on this order" : `${n} credit notes on this order`;
}
