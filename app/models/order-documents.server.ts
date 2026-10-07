/**
 * Group 15 Phase B — order-document APIs for Admin UI extensions.
 *
 * Port of old `order-documents.service.ts`. Reuses Groups 7/8/10–13.
 * Does not record download events (print/preview).
 */
import type { CreditNote, Invoice } from "@prisma/client";

import prisma from "../db.server";
import {
  renderCreditNoteDocument,
  renderRefundDocument,
} from "./credit-note-document.server";
import { sendInvoiceEmail } from "./document-email.server";
import {
  createInvoiceFromShopifyOrder,
  type ShopifyOrder,
} from "./invoice-create.server";
import {
  renderInvoiceDocument,
  renderPackingSlipDocument,
} from "./invoice-document.server";
import { issueInvoicePublicLinkForShop } from "./public-link.server";
import { fetchOrderById } from "./shopify-admin-graphql.server";
import { mergeDocumentHtml } from "./template-render-engine.server";

export type OrderPrintType =
  | "invoice"
  | "packing_slip"
  | "credit_note"
  | "refund_document";

export type OrderDocumentsDeps = {
  fetchOrderById?: typeof fetchOrderById;
  createInvoiceFromShopifyOrder?: typeof createInvoiceFromShopifyOrder;
  renderInvoiceDocument?: typeof renderInvoiceDocument;
  renderPackingSlipDocument?: typeof renderPackingSlipDocument;
  renderCreditNoteDocument?: typeof renderCreditNoteDocument;
  renderRefundDocument?: typeof renderRefundDocument;
  sendInvoiceEmail?: typeof sendInvoiceEmail;
  issueInvoicePublicLinkForShop?: typeof issueInvoicePublicLinkForShop;
};

type BuyerJson = { name?: string; email?: string };
type TotalsJson = { grandTotal?: number };

/**
 * Normalize Shopify order GID or numeric id → digits only.
 * `String(orderId).replace(/\D/g, "")` (Phase B / extension parity).
 */
export function normalizeShopifyOrderId(
  raw: string | number | null | undefined,
): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** @deprecated alias — old name */
export function parseShopifyOrderId(
  raw: string | undefined | null,
): string | null {
  return normalizeShopifyOrderId(raw);
}

function readBuyer(value: unknown): BuyerJson {
  if (!value || typeof value !== "object") return {};
  const buyer = value as BuyerJson;
  return {
    name: typeof buyer.name === "string" ? buyer.name : undefined,
    email: typeof buyer.email === "string" ? buyer.email : undefined,
  };
}

function readGrandTotal(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const totals = value as TotalsJson;
  return Number(totals.grandTotal) || 0;
}

function mapInvoiceSummary(invoice: Invoice) {
  const buyer = readBuyer(invoice.buyer);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    grandTotal: readGrandTotal(invoice.totals),
    buyerEmail: buyer.email ?? "",
    buyerName: buyer.name ?? "",
    orderNumber: invoice.shopifyOrderNumber ?? "",
    issueDate: invoice.issueDate
      ? invoice.issueDate.toISOString()
      : null,
  };
}

function mapCreditNoteSummary(cn: CreditNote) {
  return {
    id: cn.id,
    creditNoteNumber: cn.creditNoteNumber,
    status: cn.status,
    currency: cn.currency,
    grandTotal: readGrandTotal(cn.totals),
  };
}

/**
 * Ensure an invoice exists for the Shopify order under the authenticated shop.
 * May create via Group 8 when missing (intentional old-app behavior).
 */
export async function ensureInvoiceForShopifyOrder(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  deps: OrderDocumentsDeps = {},
): Promise<
  | { ok: true; invoice: Invoice; created: boolean; storeId: string }
  | { ok: false; error: string }
> {
  const shopifyOrderId = normalizeShopifyOrderId(shopifyOrderIdRaw);
  if (!shopifyOrderId) {
    return { ok: false, error: "Invalid order id" };
  }

  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return { ok: false, error: "Store not found" };

  const existing = await prisma.invoice.findUnique({
    where: {
      storeId_shopifyOrderId: {
        storeId: store.id,
        shopifyOrderId,
      },
    },
  });
  if (existing) {
    return {
      ok: true,
      invoice: existing,
      created: false,
      storeId: store.id,
    };
  }

  const fetchOrder = deps.fetchOrderById ?? fetchOrderById;
  const createInvoice =
    deps.createInvoiceFromShopifyOrder ?? createInvoiceFromShopifyOrder;

  try {
    const fetched = await fetchOrder(shopDomain, shopifyOrderId);
    const order = fetched?.order;
    if (!order) {
      return { ok: false, error: "Order not found in Shopify" };
    }

    const invoice = await createInvoice(shopDomain, order as ShopifyOrder, "sync");
    if (!invoice) {
      // Race: another request may have created it.
      const raced = await prisma.invoice.findUnique({
        where: {
          storeId_shopifyOrderId: {
            storeId: store.id,
            shopifyOrderId,
          },
        },
      });
      if (raced) {
        return {
          ok: true,
          invoice: raced,
          created: false,
          storeId: store.id,
        };
      }
      return { ok: false, error: "Failed to create invoice for this order" };
    }

    return {
      ok: true,
      invoice,
      created: true,
      storeId: store.id,
    };
  } catch (error) {
    console.error("[order-documents] ensure invoice failed:", error);
    // Unique race after throw from create path
    const raced = await prisma.invoice.findUnique({
      where: {
        storeId_shopifyOrderId: {
          storeId: store.id,
          shopifyOrderId,
        },
      },
    });
    if (raced) {
      return {
        ok: true,
        invoice: raced,
        created: false,
        storeId: store.id,
      };
    }
    return { ok: false, error: "Failed to create invoice for this order" };
  }
}

export async function getOrderDocumentsSummary(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  deps: OrderDocumentsDeps = {},
) {
  const ensured = await ensureInvoiceForShopifyOrder(
    shopDomain,
    shopifyOrderIdRaw,
    deps,
  );
  if (!ensured.ok) {
    return { ok: false as const, error: ensured.error };
  }

  const shopifyOrderId =
    normalizeShopifyOrderId(shopifyOrderIdRaw) ||
    ensured.invoice.shopifyOrderId;

  const creditNotes = await prisma.creditNote.findMany({
    where: {
      storeId: ensured.storeId,
      shopifyOrderId: String(shopifyOrderId),
    },
    orderBy: { createdAt: "desc" },
  });

  const creditNoteSummaries = creditNotes.map(mapCreditNoteSummary);

  return {
    ok: true as const,
    orderId: String(shopifyOrderId),
    invoice: mapInvoiceSummary(ensured.invoice),
    creditNotes: creditNoteSummaries,
    /** Convenience for Block/Action UIs (same as creditNotes.length). */
    creditNotesCount: creditNoteSummaries.length,
    created: ensured.created,
  };
}

/**
 * Normalize print type list.
 * Accepts `types` / `printType` comma lists.
 * Empty/missing → [] (caller returns 400).
 * Preserves first-seen order; dedupes.
 */
export function normalizePrintTypes(raw: string | null | undefined): OrderPrintType[] {
  if (raw == null || !String(raw).trim()) return [];

  const parts = String(raw)
    .split(",")
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);

  const mapped: OrderPrintType[] = [];
  for (const part of parts) {
    if (part === "invoice" || part === "tax_invoice") mapped.push("invoice");
    else if (
      part === "packing_slip" ||
      part === "packing" ||
      part === "packing_slips"
    ) {
      mapped.push("packing_slip");
    } else if (part === "credit_note" || part === "credit_notes") {
      mapped.push("credit_note");
    } else if (part === "refund_document" || part === "refund") {
      mapped.push("refund_document");
    }
  }

  return [...new Set(mapped)];
}

export function readPrintTypesFromRequest(request: Request): OrderPrintType[] {
  const url = new URL(request.url);
  const raw =
    url.searchParams.get("types") ?? url.searchParams.get("printType");
  return normalizePrintTypes(raw);
}

export async function buildOrderPrintHtml(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  printTypeRaw: string | null | undefined,
  deps: OrderDocumentsDeps = {},
) {
  const types = normalizePrintTypes(printTypeRaw);
  if (!types.length) {
    return { ok: false as const, error: "Missing or empty types", status: 400 as const };
  }

  const summary = await getOrderDocumentsSummary(
    shopDomain,
    shopifyOrderIdRaw,
    deps,
  );
  if (!summary.ok) {
    return { ok: false as const, error: summary.error, status: 404 as const };
  }

  const renderInvoice = deps.renderInvoiceDocument ?? renderInvoiceDocument;
  const renderPacking =
    deps.renderPackingSlipDocument ?? renderPackingSlipDocument;
  const renderCn = deps.renderCreditNoteDocument ?? renderCreditNoteDocument;
  const renderRefund = deps.renderRefundDocument ?? renderRefundDocument;

  const pages: string[] = [];
  const labels: string[] = [];

  for (const type of types) {
    if (type === "invoice") {
      const doc = await renderInvoice(shopDomain, summary.invoice.id);
      if (doc) {
        pages.push(doc.html);
        labels.push(`Tax invoice ${doc.invoiceNumber}`);
      }
    } else if (type === "packing_slip") {
      const doc = await renderPacking(shopDomain, summary.invoice.id);
      if (doc) {
        pages.push(doc.html);
        labels.push(`Packing slip ${doc.orderNumber}`);
      }
    } else if (type === "credit_note" || type === "refund_document") {
      // Old parity: iterate all credit notes for the order; renderer differs by type.
      for (const cn of summary.creditNotes) {
        const doc =
          type === "credit_note"
            ? await renderCn(shopDomain, cn.id)
            : await renderRefund(shopDomain, cn.id);
        if (doc) {
          pages.push(doc.html);
          labels.push(
            type === "credit_note"
              ? `Credit note ${cn.creditNoteNumber}`
              : `Refund ${cn.creditNoteNumber}`,
          );
        }
      }
    }
  }

  if (!pages.length) {
    return {
      ok: false as const,
      error:
        types.includes("credit_note") || types.includes("refund_document")
          ? "No credit notes / refunds found for this order"
          : "Failed to render documents",
      status: 404 as const,
    };
  }

  const title =
    labels.length === 1
      ? labels[0]
      : `Order ${summary.invoice.orderNumber || summary.orderId} documents`;

  return {
    ok: true as const,
    html: pages.length === 1 ? pages[0] : mergeDocumentHtml(pages, title),
    title,
    invoice: summary.invoice,
    types,
  };
}

export async function buildOrderInvoicePreviewHtml(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  deps: OrderDocumentsDeps = {},
) {
  const summary = await getOrderDocumentsSummary(
    shopDomain,
    shopifyOrderIdRaw,
    deps,
  );
  if (!summary.ok) {
    return { ok: false as const, error: summary.error };
  }

  const renderInvoice = deps.renderInvoiceDocument ?? renderInvoiceDocument;
  const doc = await renderInvoice(shopDomain, summary.invoice.id);
  if (!doc) {
    return { ok: false as const, error: "Failed to render invoice preview" };
  }

  return {
    ok: true as const,
    html: doc.html,
    invoiceNumber: doc.invoiceNumber,
    templateName: doc.templateName,
  };
}

export async function emailOrderInvoice(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  deps: OrderDocumentsDeps = {},
) {
  const summary = await getOrderDocumentsSummary(
    shopDomain,
    shopifyOrderIdRaw,
    deps,
  );
  if (!summary.ok) return { ok: false as const, error: summary.error };

  if (!summary.invoice.buyerEmail) {
    return {
      ok: false as const,
      error: "Customer email is missing on this order",
    };
  }

  const send = deps.sendInvoiceEmail ?? sendInvoiceEmail;
  const result = await send({
    shop: shopDomain,
    invoiceId: summary.invoice.id,
    trigger: "manual",
  });

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error || "Failed to send email",
    };
  }

  return {
    ok: true as const,
    messageId: result.providerId,
    to: result.to,
    invoiceNumber: summary.invoice.invoiceNumber,
  };
}

export async function issueOrderInvoicePublicLink(
  shopDomain: string,
  shopifyOrderIdRaw: string,
  deps: OrderDocumentsDeps = {},
) {
  const summary = await getOrderDocumentsSummary(
    shopDomain,
    shopifyOrderIdRaw,
    deps,
  );
  if (!summary.ok) return { ok: false as const, error: summary.error };

  const issue =
    deps.issueInvoicePublicLinkForShop ?? issueInvoicePublicLinkForShop;
  const result = await issue(shopDomain, summary.invoice.id);
  if (!result) {
    return { ok: false as const, error: "Failed to create customer link" };
  }

  return {
    ok: true as const,
    url: result.url,
    expiresAt: result.expiresAt,
    invoiceNumber: summary.invoice.invoiceNumber,
  };
}

export function printErrorHtml(message: string): string {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Print error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 48px; color: #202223; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    p { color: #6d7175; margin: 0; }
  </style>
</head>
<body>
  <h1>Unable to print</h1>
  <p>${safe}</p>
</body>
</html>`;
}
