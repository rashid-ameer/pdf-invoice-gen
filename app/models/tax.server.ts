import type { InvoiceLineItem, InvoiceTotals } from "../types/index";

/** Line fields required for discount allocation (extra fields are preserved). */
export type DiscountableLine = Pick<
  InvoiceLineItem,
  | "sku"
  | "description"
  | "productTitle"
  | "variantTitle"
  | "imageUrl"
  | "barcode"
  | "quantity"
  | "unitPrice"
  | "discount"
  | "vatRate"
  | "vatAmount"
  | "lineTotal"
> &
  Partial<InvoiceLineItem>;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function grossSubtotalForLines(
  lineItems: Array<{ unitPrice: number; quantity: number }>,
): number {
  return roundMoney(
    lineItems.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  );
}

export function lineDiscountSum(
  lineItems: Array<{ discount?: number }>,
): number {
  return roundMoney(
    lineItems.reduce((sum, line) => sum + (line.discount || 0), 0),
  );
}

/** Spread order-level coupon discount onto lines when Shopify did not fill line.discount. */
export function allocateOrderDiscountToLines<T extends DiscountableLine>(
  lineItems: T[],
  orderDiscount: number,
): T[] {
  const grossSubtotal = grossSubtotalForLines(lineItems);
  const allocated = lineDiscountSum(lineItems);
  const remaining = roundMoney(orderDiscount - allocated);
  if (remaining <= 0.001 || grossSubtotal <= 0 || lineItems.length === 0) {
    return lineItems;
  }

  const next = lineItems.map((line) => ({ ...line }));
  let assigned = 0;
  for (let i = 0; i < next.length; i++) {
    const line = next[i];
    const gross = line.unitPrice * line.quantity;
    const share =
      i === next.length - 1
        ? roundMoney(remaining - assigned)
        : roundMoney((gross / grossSubtotal) * remaining);
    assigned = roundMoney(assigned + share);
    line.discount = roundMoney((line.discount || 0) + share);
    const net = gross - line.discount;
    line.lineTotal = roundMoney(net + (line.vatAmount || 0));
  }
  return next;
}

export function normalizeInvoiceDiscounts<T extends DiscountableLine>(input: {
  lineItems: T[];
  totals: InvoiceTotals;
}): { lineItems: T[]; totals: InvoiceTotals; changed: boolean } {
  const grossSubtotal = grossSubtotalForLines(input.lineItems);
  const orderDiscount = input.totals.discount ?? 0;
  let lineItems = input.lineItems.map((line) => ({ ...line }));
  let totals = { ...input.totals };
  let changed = false;

  if (orderDiscount > 0 && lineDiscountSum(lineItems) + 0.01 < orderDiscount) {
    lineItems = allocateOrderDiscountToLines(lineItems, orderDiscount);
    changed = true;
  }

  if (
    grossSubtotal > 0 &&
    totals.subtotal + 0.01 < grossSubtotal &&
    orderDiscount > 0
  ) {
    totals = { ...totals, subtotal: grossSubtotal };
    changed = true;
  }

  return { lineItems, totals, changed };
}

/**
 * Pure VAT repair: clear invented 5% label when Shopify recorded no tax.
 * Preserves extra line fields (unlike the old Mongo repair mapper).
 * Rounding: lineTotal for repaired lines is unrounded (old parity).
 */
export function alignVatRatesToAmounts<T extends DiscountableLine>(input: {
  lineItems: T[];
  totals?: InvoiceTotals | null;
}): { lineItems: T[]; totals: InvoiceTotals | null | undefined; changed: boolean } {
  let changed = false;
  const lineItems = input.lineItems.map((line) => {
    const vatAmount = line.vatAmount ?? 0;
    const vatRate = line.vatRate ?? 0;
    if (vatAmount === 0 && vatRate === 5) {
      changed = true;
      const net = line.unitPrice * line.quantity - (line.discount || 0);
      return {
        ...line,
        discount: line.discount ?? 0,
        vatRate: 0,
        vatAmount: 0,
        lineTotal: net,
      };
    }
    return {
      ...line,
      discount: line.discount ?? 0,
      vatRate,
      vatAmount,
      lineTotal: line.lineTotal,
    };
  });

  if (!changed) {
    return { lineItems: input.lineItems, totals: input.totals, changed: false };
  }

  let totals = input.totals;
  if (totals && (totals.vatTotal ?? 0) === 0) {
    totals = {
      subtotal: totals.subtotal ?? 0,
      discount: totals.discount ?? 0,
      vatTotal: 0,
      shipping: totals.shipping ?? 0,
      grandTotal: totals.grandTotal ?? 0,
      ...(totals.totalWithoutTax !== undefined
        ? { totalWithoutTax: totals.totalWithoutTax }
        : {}),
      ...(totals.amountDue !== undefined ? { amountDue: totals.amountDue } : {}),
    };
  }

  return { lineItems, totals, changed: true };
}
