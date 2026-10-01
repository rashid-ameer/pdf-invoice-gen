import type {
  BuyerInfo,
  InvoiceLineItem,
  InvoiceTotals,
  PintInvoiceMetadata,
  PintTaxBreakdownRow,
  SellerInfo,
} from "../types/index";
import {
  PINT_AE_BUSINESS_PROCESS,
  PINT_AE_SPECIFICATION_ID,
  PINT_INVOICE_TYPE_TAX,
  PINT_PAYMENT_MEANS_DEFAULT,
  PINT_TAX_CATEGORY_STANDARD,
  PINT_TAX_CATEGORY_ZERO,
  PINT_TAX_SCHEME_VAT,
  PINT_TRANSACTION_TYPE_DEFAULT,
  PINT_UNIT_EACH,
} from "./pint.constants";

export type { PintInvoiceMetadata, PintTaxBreakdownRow };

type LineLike = Pick<
  InvoiceLineItem,
  | "quantity"
  | "unitPrice"
  | "discount"
  | "vatRate"
  | "vatAmount"
  | "lineNetAmount"
  | "lineTotal"
>;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lineNetAmountForItem(item: {
  quantity: number;
  unitPrice: number;
  discount?: number;
  vatAmount?: number;
  lineTotal?: number;
}): number {
  const discount = item.discount ?? 0;
  const gross = item.quantity * item.unitPrice - discount;
  if (item.vatAmount != null && item.lineTotal != null) {
    return roundMoney(item.lineTotal - item.vatAmount);
  }
  return roundMoney(Math.max(gross, 0));
}

export function taxCategoryForRate(vatRate: number): string {
  if (vatRate > 0) return PINT_TAX_CATEGORY_STANDARD;
  return PINT_TAX_CATEGORY_ZERO;
}

export function computeTaxBreakdown(
  lineItems: LineLike[],
): PintTaxBreakdownRow[] {
  const buckets = new Map<number, { taxableAmount: number; taxAmount: number }>();
  for (const line of lineItems) {
    const rate = roundMoney(line.vatRate ?? 0);
    const net = line.lineNetAmount ?? lineNetAmountForItem(line);
    const tax = roundMoney(line.vatAmount ?? 0);
    const bucket = buckets.get(rate) ?? { taxableAmount: 0, taxAmount: 0 };
    bucket.taxableAmount = roundMoney(bucket.taxableAmount + net);
    bucket.taxAmount = roundMoney(bucket.taxAmount + tax);
    buckets.set(rate, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, amounts]) => ({
      categoryCode: taxCategoryForRate(rate),
      rate,
      taxableAmount: amounts.taxableAmount,
      taxAmount: amounts.taxAmount,
    }));
}

export function buildPintMetadata(input: {
  issueDate: Date;
  lineItems: LineLike[];
  totals: InvoiceTotals;
  dueDate?: Date;
  invoiceTypeCode?: string;
}): PintInvoiceMetadata {
  const sumLineNetAmount = roundMoney(
    input.lineItems.reduce(
      (sum, line) => sum + (line.lineNetAmount ?? lineNetAmountForItem(line)),
      0,
    ),
  );
  const totalWithoutTax = roundMoney(
    sumLineNetAmount + (input.totals.shipping ?? 0),
  );
  const amountDue = roundMoney(input.totals.grandTotal);
  const taxBreakdown = computeTaxBreakdown(input.lineItems);

  return {
    invoiceTypeCode: input.invoiceTypeCode ?? PINT_INVOICE_TYPE_TAX,
    transactionTypeCode: PINT_TRANSACTION_TYPE_DEFAULT,
    specificationId: PINT_AE_SPECIFICATION_ID,
    businessProcessType: PINT_AE_BUSINESS_PROCESS,
    paymentMeansCode: PINT_PAYMENT_MEANS_DEFAULT,
    dueDate: input.dueDate,
    sumLineNetAmount,
    totalWithoutTax,
    amountDue,
    taxBreakdown,
  };
}

export function enrichLineItemsForPint<
  T extends {
    quantity: number;
    unitPrice: number;
    discount?: number;
    vatRate: number;
    vatAmount: number;
    lineTotal: number;
    lineId?: string;
    unitOfMeasure?: string;
    lineNetAmount?: number;
    taxCategoryCode?: string;
  },
>(lineItems: T[]): T[] {
  return lineItems.map((line, index) => {
    const lineNetAmount = lineNetAmountForItem(line);
    return {
      ...line,
      lineId: line.lineId ?? String(index + 1),
      unitOfMeasure: line.unitOfMeasure ?? PINT_UNIT_EACH,
      lineNetAmount,
      taxCategoryCode: line.taxCategoryCode ?? taxCategoryForRate(line.vatRate),
    };
  });
}

export function parseBuyerIdentifiersFromOrder(order: {
  note_attributes?: Array<{ name?: string; value?: string }>;
  billing_address?: { company?: string };
}): Pick<BuyerInfo, "trn" | "tin" | "legalName"> {
  const attrs = order.note_attributes ?? [];
  const map = Object.fromEntries(
    attrs
      .filter((a) => a.name && a.value)
      .map((a) => [String(a.name).trim().toLowerCase(), String(a.value).trim()]),
  );
  const trn =
    map.buyer_trn ||
    map.customer_trn ||
    map.vat_number ||
    map.vat_trn ||
    map.trn ||
    undefined;
  const tin = map.buyer_tin || map.peppol_id || map.electronic_address || undefined;
  const legalName = order.billing_address?.company?.trim() || undefined;
  return { trn, tin, legalName };
}

/** Structured payload for future ASP / Storecove submission. */
export function mapInvoiceToPintPayload(invoice: {
  invoiceNumber: string;
  issueDate: Date;
  currency: string;
  seller: SellerInfo;
  buyer: BuyerInfo;
  lineItems: InvoiceLineItem[];
  totals: InvoiceTotals;
  pint?: PintInvoiceMetadata | null;
}) {
  const pint =
    invoice.pint ??
    buildPintMetadata({
      issueDate: invoice.issueDate,
      lineItems: invoice.lineItems,
      totals: invoice.totals,
    });

  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    currency: invoice.currency,
    ...pint,
    seller: {
      name: invoice.seller.legalName,
      tradeName: invoice.seller.tradeName,
      trn: invoice.seller.trn,
      tin: invoice.seller.tin,
      taxSchemeCode: invoice.seller.taxSchemeCode ?? PINT_TAX_SCHEME_VAT,
      tradeLicence: invoice.seller.tradeLicence,
      email: invoice.seller.businessEmail,
      phone: invoice.seller.businessPhone,
      address: invoice.seller.address,
    },
    buyer: {
      name: invoice.buyer.legalName ?? invoice.buyer.name,
      trn: invoice.buyer.trn,
      tin: invoice.buyer.tin,
      taxSchemeCode: invoice.buyer.taxSchemeCode ?? PINT_TAX_SCHEME_VAT,
      email: invoice.buyer.email,
      phone: invoice.buyer.phone,
      address: invoice.buyer.address,
    },
    lineItems: invoice.lineItems.map((line) => ({
      lineId: line.lineId,
      name: line.productTitle ?? line.description,
      description: line.description,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure ?? PINT_UNIT_EACH,
      unitPrice: line.unitPrice,
      lineNetAmount: line.lineNetAmount ?? lineNetAmountForItem(line),
      vatRate: line.vatRate,
      vatAmount: line.vatAmount,
      taxCategoryCode: line.taxCategoryCode ?? taxCategoryForRate(line.vatRate),
      lineTotal: line.lineTotal,
    })),
    totals: invoice.totals,
    taxBreakdown: pint.taxBreakdown,
  };
}
