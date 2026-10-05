import { Prisma, type CreditNote, type Invoice } from "@prisma/client";
import type { InvoiceLineItem, InvoiceTotals } from "../types/index";
import { DEFAULT_CURRENCY } from "../constants/app";
import prisma from "../db.server";
import { nextCreditNoteNumber } from "./document-number.server";

export interface ShopifyRefundLineItem {
  id?: number;
  quantity: number;
  subtotal?: string | number;
  total_tax?: string | number;
  line_item_id?: number;
  line_item?: {
    id?: number;
    title?: string;
    name?: string;
    sku?: string | null;
    quantity?: number;
    price?: string;
    variant_title?: string | null;
    tax_lines?: Array<{ rate?: number; price?: string }>;
  };
}

export interface ShopifyRefund {
  id: number;
  order_id: number;
  created_at?: string;
  note?: string | null;
  restock?: boolean;
  refund_line_items?: ShopifyRefundLineItem[];
  transactions?: Array<{ amount?: string; currency?: string; status?: string }>;
  order_adjustments?: Array<{
    amount?: string;
    tax_amount?: string;
    kind?: string;
    reason?: string;
  }>;
}

export type CreditNoteCreateSource = "webhook" | "sync";

function parseAmount(value: string | number | undefined | null): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function normalizeDesc(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function parseLineItems(value: unknown): InvoiceLineItem[] {
  return (Array.isArray(value) ? value : []) as InvoiceLineItem[];
}

/** Prefer VAT treatment from the original tax invoice so credit notes match invoices. */
export function resolveVatFromInvoice(
  invoiceLines: InvoiceLineItem[],
  refundItem: ShopifyRefundLineItem,
  subtotal: number,
  shopifyTax: number,
): { vatRate: number; vatAmount: number } {
  const li = refundItem.line_item;
  const sku = (li?.sku || "").trim().toLowerCase();
  const title = normalizeDesc(li?.title || li?.name);
  const variant = normalizeDesc(li?.variant_title);
  const description = variant ? `${title} — ${variant}` : title;

  const matched =
    invoiceLines.find(
      (inv) => sku && inv.sku && inv.sku.trim().toLowerCase() === sku,
    ) ||
    invoiceLines.find((inv) => normalizeDesc(inv.description) === description) ||
    invoiceLines.find(
      (inv) => normalizeDesc(inv.description).startsWith(title) && title,
    ) ||
    (invoiceLines.length === 1 ? invoiceLines[0] : undefined);

  const rateFromShopifyLines =
    li?.tax_lines && li.tax_lines.length > 0 && li.tax_lines[0].rate != null
      ? li.tax_lines[0].rate * 100
      : null;

  // Match invoice rate first so CN shows the same VAT % as the tax invoice.
  const vatRate =
    matched?.vatRate != null
      ? matched.vatRate
      : rateFromShopifyLines != null
        ? rateFromShopifyLines
        : shopifyTax > 0 && subtotal > 0
          ? (shopifyTax / subtotal) * 100
          : 0;

  // Prefer Shopify refund tax when present; otherwise mirror the invoice line amounts.
  let vatAmount = shopifyTax;
  if (vatAmount <= 0 && matched) {
    vatAmount =
      matched.quantity > 0
        ? Math.round(
            (matched.vatAmount / matched.quantity) *
              (refundItem.quantity || 1) *
              100,
          ) / 100
        : matched.vatAmount;
  }
  if (
    vatAmount <= 0 &&
    shopifyTax <= 0 &&
    (!matched || matched.vatAmount <= 0)
  ) {
    // Only compute from rate when neither Shopify nor the invoice recorded tax amounts
    // but a positive rate is being applied for display consistency with calculated invoices.
    vatAmount = 0;
  }

  return { vatRate, vatAmount };
}

/** Old mapRefundLineItems — exported for focused unit tests. */
export function mapRefundLineItems(
  refund: ShopifyRefund,
  invoiceLines: InvoiceLineItem[] = [],
): InvoiceLineItem[] {
  const items = refund.refund_line_items ?? [];
  if (items.length === 0) {
    // Shipping-only or adjustment refund — synthesize a single line from transactions
    const amount = (refund.transactions ?? []).reduce(
      (sum, tx) => sum + parseAmount(tx.amount),
      0,
    );
    const adjustmentTax = (refund.order_adjustments ?? []).reduce(
      (sum, adj) => sum + Math.abs(parseAmount(adj.tax_amount)),
      0,
    );
    if (amount <= 0 && adjustmentTax <= 0) return [];

    const defaultRate =
      invoiceLines.find((l) => (l.vatRate ?? 0) > 0)?.vatRate ??
      (invoiceLines[0]?.vatRate != null ? invoiceLines[0].vatRate : 0);
    const net =
      adjustmentTax > 0
        ? Math.max(amount - adjustmentTax, 0)
        : amount / (1 + defaultRate / 100);
    const vatAmount =
      adjustmentTax > 0
        ? adjustmentTax
        : Math.round((amount - net) * 100) / 100;

    return [
      {
        description: refund.note?.trim() || "Refund adjustment",
        quantity: 1,
        unitPrice: net,
        discount: 0,
        vatRate: defaultRate,
        vatAmount,
        lineTotal: amount || net + vatAmount,
      },
    ];
  }

  return items.map((item) => {
    const li = item.line_item;
    const qty = item.quantity || 1;
    const subtotal = parseAmount(item.subtotal);
    const shopifyTax = parseAmount(item.total_tax);
    const unitFromLine = li?.price
      ? parseAmount(li.price)
      : qty > 0
        ? subtotal / qty
        : subtotal;
    const { vatRate, vatAmount } = resolveVatFromInvoice(
      invoiceLines,
      item,
      subtotal || unitFromLine * qty,
      shopifyTax,
    );
    const net = subtotal || unitFromLine * qty;
    const title = li?.title || li?.name || "Refunded item";
    const description = li?.variant_title
      ? `${title} — ${li.variant_title}`
      : title;
    const sku = (li?.sku || "").trim().toLowerCase();
    const normDescription = normalizeDesc(description);
    const matched =
      invoiceLines.find(
        (inv) => sku && inv.sku && inv.sku.trim().toLowerCase() === sku,
      ) ||
      invoiceLines.find(
        (inv) => normalizeDesc(inv.description) === normDescription,
      ) ||
      invoiceLines.find(
        (inv) =>
          normalizeDesc(inv.description).startsWith(normalizeDesc(title)) &&
          title,
      ) ||
      (invoiceLines.length === 1 ? invoiceLines[0] : undefined);

    return {
      sku: li?.sku || matched?.sku || undefined,
      description: matched?.description || description,
      productTitle: matched?.productTitle || title,
      variantTitle: matched?.variantTitle || li?.variant_title?.trim() || undefined,
      imageUrl: matched?.imageUrl,
      barcode: matched?.barcode,
      quantity: qty,
      unitPrice: unitFromLine,
      discount: 0,
      vatRate,
      vatAmount,
      lineTotal: net + vatAmount,
    };
  });
}

export function sumCreditNoteTotals(
  lineItems: InvoiceLineItem[],
  shipping = 0,
): InvoiceTotals {
  const subtotal = lineItems.reduce(
    (sum, i) => sum + i.unitPrice * i.quantity - (i.discount || 0),
    0,
  );
  const vatTotal = lineItems.reduce((sum, i) => sum + i.vatAmount, 0);
  const grandTotal =
    lineItems.reduce((sum, i) => sum + i.lineTotal, 0) + shipping;
  return {
    subtotal,
    discount: 0,
    vatTotal,
    shipping,
    grandTotal,
  };
}

/** Fix credit note lines that inherited 0% tax from Shopify while the invoice used a different rate. */
export async function repairCreditNoteVat(
  creditNoteId: string,
  invoiceLines: InvoiceLineItem[],
): Promise<void> {
  const note = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  if (!note) return;

  const lineItems = parseLineItems(note.lineItems);
  if (!lineItems.length) return;

  const needsRepair = lineItems.some(
    (line) =>
      ((line.vatRate ?? 0) === 0 && (line.vatAmount ?? 0) === 0) ||
      ((line.vatRate ?? 0) === 5 && (line.vatAmount ?? 0) === 0),
  );
  if (!needsRepair) return;

  const defaultRate =
    invoiceLines.find((l) => (l.vatRate ?? 0) > 0)?.vatRate ??
    invoiceLines[0]?.vatRate ??
    0;

  const repaired = lineItems.map((line) => {
    const matched =
      invoiceLines.find(
        (inv) =>
          line.sku &&
          inv.sku &&
          inv.sku.trim().toLowerCase() === line.sku.trim().toLowerCase(),
      ) ||
      invoiceLines.find(
        (inv) => normalizeDesc(inv.description) === normalizeDesc(line.description),
      ) ||
      (invoiceLines.length === 1 ? invoiceLines[0] : undefined);

    const shouldRealign =
      ((line.vatRate ?? 0) === 0 && (line.vatAmount ?? 0) === 0) ||
      ((line.vatRate ?? 0) === 5 && (line.vatAmount ?? 0) === 0);

    if (!shouldRealign) {
      return {
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount ?? 0,
        vatRate: line.vatRate,
        vatAmount: line.vatAmount,
        lineTotal: line.lineTotal,
      };
    }

    const vatRate = matched?.vatRate != null ? matched.vatRate : defaultRate;
    const net = line.unitPrice * line.quantity - (line.discount || 0);
    const vatAmount =
      matched && matched.quantity > 0
        ? Math.round(
            (matched.vatAmount / matched.quantity) * line.quantity * 100,
          ) / 100
        : 0;

    return {
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount ?? 0,
      vatRate,
      vatAmount,
      lineTotal: net + vatAmount,
    };
  });

  const totals = sumCreditNoteTotals(repaired as InvoiceLineItem[]);
  await prisma.creditNote.update({
    where: { id: creditNoteId },
    data: {
      lineItems: toJson(repaired),
      totals: toJson(totals),
    },
  });
  console.log(`[credit-notes] repaired VAT on ${note.creditNoteNumber}`);
}

async function loadExistingCreditNote(
  storeId: string,
  shopifyRefundId: string,
): Promise<CreditNote | null> {
  return prisma.creditNote.findUnique({
    where: {
      storeId_shopifyRefundId: {
        storeId,
        shopifyRefundId,
      },
    },
  });
}

/**
 * Create a credit note from a Shopify refund payload (Sufio-style: separate doc linked to invoice).
 * No Shopify API calls — usable by webhook and sync entry points.
 */
export async function createCreditNoteFromRefund(
  shopDomain: string,
  refund: ShopifyRefund,
  source: CreditNoteCreateSource = "webhook",
): Promise<CreditNote | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) {
    console.warn(`[credit-notes] store not found for ${shopDomain}`);
    return null;
  }

  const refundId = String(refund.id);
  const invoice = await prisma.invoice.findUnique({
    where: {
      storeId_shopifyOrderId: {
        storeId: store.id,
        shopifyOrderId: String(refund.order_id),
      },
    },
  });
  if (!invoice) {
    console.warn(
      `[credit-notes] no invoice for order ${refund.order_id} on ${shopDomain} — sync orders first`,
    );
    return null;
  }

  const invoiceLines = parseLineItems(invoice.lineItems);

  const existing = await loadExistingCreditNote(store.id, refundId);
  if (existing) {
    await repairCreditNoteVat(existing.id, invoiceLines);
    console.log(`[credit-notes] already exists for refund ${refundId}`);
    return (
      (await prisma.creditNote.findUnique({ where: { id: existing.id } })) ??
      existing
    );
  }

  const lineItems = mapRefundLineItems(refund, invoiceLines);
  if (lineItems.length === 0) {
    throw new Error(
      `Refund ${refundId} has no refundable line items or amounts`,
    );
  }

  const totals = sumCreditNoteTotals(lineItems);
  const creditNoteNumber = await nextCreditNoteNumber(
    store.id,
    store.merchantId,
  );

  try {
    const creditNote = await prisma.$transaction(async (tx) => {
      const created = await tx.creditNote.create({
        data: {
          merchantId: store.merchantId,
          storeId: store.id,
          invoiceId: invoice.id,
          shopifyRefundId: refundId,
          shopifyOrderId: String(refund.order_id),
          creditNoteNumber,
          status: "generated",
          reason: refund.note?.trim() || "Refund / return",
          issueDate: new Date(refund.created_at || Date.now()),
          currency: invoice.currency || store.currency || DEFAULT_CURRENCY,
          seller: toJson(invoice.seller),
          buyer: toJson(invoice.buyer),
          lineItems: toJson(lineItems),
          totals: toJson(totals),
        },
      });

      await tx.invoiceStatusEvent.create({
        data: {
          invoiceId: invoice.id,
          creditNoteId: created.id,
          status: "generated",
          source: source === "sync" ? "merchant" : "shopify",
          message: `Credit note ${creditNoteNumber} created for refund on ${invoice.invoiceNumber}`,
          metadata: toJson({
            shopifyRefundId: refundId,
            shopifyOrderId: refund.order_id,
            creditNoteNumber,
            source,
          }),
        },
      });

      return created;
    });

    console.log(
      `[credit-notes] created ${creditNoteNumber} for invoice ${invoice.invoiceNumber} via ${source}`,
    );

    return creditNote;
  } catch (error) {
    // Concurrent webhook/sync: unique (storeId, shopifyRefundId) already taken.
    if (isUniqueConflict(error)) {
      const raced = await loadExistingCreditNote(store.id, refundId);
      if (raced) {
        console.log(
          `[credit-notes] duplicate create race resolved for refund ${refundId} → ${raced.creditNoteNumber}`,
        );
        await repairCreditNoteVat(raced.id, invoiceLines);
        return (
          (await prisma.creditNote.findUnique({ where: { id: raced.id } })) ??
          raced
        );
      }
    }
    throw error;
  }
}

/** Test helper — parse stored JSON line items. */
export function parseCreditNoteLineItems(note: CreditNote): InvoiceLineItem[] {
  return parseLineItems(note.lineItems);
}

/** Test helper — parse stored totals. */
export function parseCreditNoteTotals(note: CreditNote): InvoiceTotals {
  const t = (note.totals ?? {}) as Partial<InvoiceTotals>;
  return {
    subtotal: Number(t.subtotal) || 0,
    discount: Number(t.discount) || 0,
    vatTotal: Number(t.vatTotal) || 0,
    shipping: Number(t.shipping) || 0,
    grandTotal: Number(t.grandTotal) || 0,
  };
}

export type { Invoice };
