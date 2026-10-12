/**
 * Pure helpers for the Order Action (Group 15 Phase E).
 * Mirrors Phase D path helpers; keeps the extension package self-contained.
 */

/**
 * @param {unknown} gidOrId
 * @returns {string | null}
 */
export function numericOrderId(gidOrId) {
  if (gidOrId == null) return null;
  const digits = String(gidOrId).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** @param {string} orderId */
export function documentsSummaryPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/documents`;
}

/**
 * @param {string} orderId
 * @param {string} [token]
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
 * Inline thumbnail for Admin action (old `/preview-image` parity).
 * @param {string} orderId
 * @param {string} [token]
 */
export function invoicePreviewImagePath(orderId, token) {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const qs = params.toString();
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/preview-image${
    qs ? `?${qs}` : ""
  }`;
}

/** @param {string} orderId */
export function invoiceEmailPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/email`;
}

/** @param {string} orderId */
export function invoiceCustomerLinkPath(orderId) {
  return `/app/api/orders/${encodeURIComponent(orderId)}/invoice/customer-link`;
}

/**
 * Old Order Action did not offer multi-doc print UI — default print is invoice only.
 * Reuses Phase B `/app/print` (same as Phase C).
 * @param {{ orderId: string; token?: string | null; types?: string[] }} opts
 * @returns {string | null}
 */
export function buildOrderActionPrintHref(opts) {
  const orderId = String(opts.orderId || "").trim();
  const types =
    Array.isArray(opts.types) && opts.types.length
      ? opts.types
      : ["invoice"];
  if (!orderId) return null;

  const params = new URLSearchParams();
  params.set("orderId", orderId);
  params.set("types", types.join(","));
  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (token) params.set("token", token);
  return `/app/print?${params.toString()}`;
}

/**
 * @param {unknown} json
 */
export function parseDocumentsSummary(json) {
  if (!json || typeof json !== "object") {
    return {
      ok: false,
      hasInvoice: false,
      invoiceNumber: "",
      invoiceStatus: "",
      orderNumber: "",
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
      orderNumber: "",
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
      orderNumber: "",
      creditNotesCount,
      error: "",
    };
  }

  return {
    ok: true,
    hasInvoice: true,
    invoiceNumber: String(inv.invoiceNumber || ""),
    invoiceStatus: String(inv.status || ""),
    orderNumber: String(inv.orderNumber || ""),
    creditNotesCount,
    error: "",
  };
}

/**
 * @param {number | string} statusOrCode
 * @param {string} [fallback]
 */
export function actionSafeErrorMessage(statusOrCode, fallback) {
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
    if (/eyJ[A-Za-z0-9_-]+\.|Bearer\s|shpat_/i.test(fallback)) {
      return "Something went wrong. Try again.";
    }
    return fallback;
  }
  return "Something went wrong. Try again.";
}

/** @param {number} count */
export function creditNotesLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1
    ? "1 credit note on this order"
    : `${n} credit notes on this order`;
}

/** Deep link used by old Order Action / Phase D block. */
export const OPEN_INVOICES_HREF = "app://app/invoices";
