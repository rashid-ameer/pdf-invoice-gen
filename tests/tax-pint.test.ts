import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocateOrderDiscountToLines,
  alignVatRatesToAmounts,
  normalizeInvoiceDiscounts,
  roundMoney,
} from "../app/models/tax.server";
import {
  buildPintMetadata,
  computeTaxBreakdown,
  enrichLineItemsForPint,
  lineNetAmountForItem,
  mapInvoiceToPintPayload,
  parseBuyerIdentifiersFromOrder,
  taxCategoryForRate,
} from "../app/models/pint.server";
import {
  PINT_AE_BUSINESS_PROCESS,
  PINT_AE_ELECTRONIC_ADDRESS_SCHEME,
  PINT_AE_SPECIFICATION_ID,
  PINT_INVOICE_TYPE_CREDIT,
  PINT_INVOICE_TYPE_TAX,
  PINT_PAYMENT_MEANS_DEFAULT,
  PINT_SELLER_REGISTRATION_SCHEME_TRADE_LICENCE,
  PINT_TAX_CATEGORY_EXEMPT,
  PINT_TAX_CATEGORY_STANDARD,
  PINT_TAX_CATEGORY_ZERO,
  PINT_TAX_SCHEME_VAT,
  PINT_TRANSACTION_TYPE_DEFAULT,
  PINT_UNIT_EACH,
} from "../app/models/pint.constants";
import type { InvoiceLineItem, InvoiceTotals } from "../app/types/index";

function line(
  partial: Partial<InvoiceLineItem> &
    Pick<InvoiceLineItem, "description" | "quantity" | "unitPrice">,
): InvoiceLineItem {
  const discount = partial.discount ?? 0;
  const vatAmount = partial.vatAmount ?? 0;
  const vatRate = partial.vatRate ?? 0;
  const gross = partial.unitPrice * partial.quantity;
  return {
    description: partial.description,
    quantity: partial.quantity,
    unitPrice: partial.unitPrice,
    discount,
    vatRate,
    vatAmount,
    lineTotal:
      partial.lineTotal ?? roundMoney(gross - discount + vatAmount),
    sku: partial.sku,
    productTitle: partial.productTitle,
    variantTitle: partial.variantTitle,
    imageUrl: partial.imageUrl,
    barcode: partial.barcode,
    lineId: partial.lineId,
    unitOfMeasure: partial.unitOfMeasure,
    lineNetAmount: partial.lineNetAmount,
    taxCategoryCode: partial.taxCategoryCode,
  };
}

describe("pint constants", () => {
  it("exports the full old constant set", () => {
    assert.equal(
      PINT_AE_SPECIFICATION_ID,
      "urn:peppol:schema:ubl-invoice:2::PINT_AE_1.0.3#PINT_AE_1.0.3",
    );
    assert.equal(PINT_AE_BUSINESS_PROCESS, "urn:peppol:bis:billing:3.0");
    assert.equal(PINT_AE_ELECTRONIC_ADDRESS_SCHEME, "0235");
    assert.equal(PINT_INVOICE_TYPE_TAX, "380");
    assert.equal(PINT_INVOICE_TYPE_CREDIT, "381");
    assert.equal(PINT_TRANSACTION_TYPE_DEFAULT, "0100000");
    assert.equal(PINT_PAYMENT_MEANS_DEFAULT, "30");
    assert.equal(PINT_UNIT_EACH, "C62");
    assert.equal(PINT_TAX_SCHEME_VAT, "VAT");
    assert.equal(PINT_TAX_CATEGORY_STANDARD, "S");
    assert.equal(PINT_TAX_CATEGORY_ZERO, "Z");
    assert.equal(PINT_TAX_CATEGORY_EXEMPT, "E");
    assert.equal(PINT_SELLER_REGISTRATION_SCHEME_TRADE_LICENCE, "TL");
  });
});

describe("allocateOrderDiscountToLines", () => {
  it("is a no-op when there is no remaining discount", () => {
    const lines = [
      line({ description: "A", quantity: 1, unitPrice: 100, discount: 10, vatAmount: 5 }),
    ];
    const result = allocateOrderDiscountToLines(lines, 10);
    assert.equal(result, lines);
    assert.equal(result[0].discount, 10);
  });

  it("spreads a single order discount across lines by gross share", () => {
    const lines = [
      line({
        description: "A",
        quantity: 1,
        unitPrice: 100,
        vatAmount: 5,
        productTitle: "Keep me",
        imageUrl: "https://example.com/a.png",
      }),
      line({ description: "B", quantity: 1, unitPrice: 100, vatAmount: 5 }),
    ];
    const result = allocateOrderDiscountToLines(lines, 20);
    assert.equal(result[0].discount, 10);
    assert.equal(result[1].discount, 10);
    assert.equal(result[0].lineTotal, 95);
    assert.equal(result[1].lineTotal, 95);
    assert.equal(result[0].vatAmount, 5);
    assert.equal(result[0].productTitle, "Keep me");
    assert.equal(result[0].imageUrl, "https://example.com/a.png");
  });

  it("assigns only the remaining discount when lines already have discounts", () => {
    const lines = [
      line({ description: "A", quantity: 1, unitPrice: 100, discount: 5, vatAmount: 0 }),
      line({ description: "B", quantity: 1, unitPrice: 100, discount: 0, vatAmount: 0 }),
    ];
    const result = allocateOrderDiscountToLines(lines, 15);
    assert.equal(result[0].discount, 10);
    assert.equal(result[1].discount, 5);
  });

  it("puts the remainder on the last line after rounding", () => {
    const lines = [
      line({ description: "A", quantity: 1, unitPrice: 10, vatAmount: 0 }),
      line({ description: "B", quantity: 1, unitPrice: 10, vatAmount: 0 }),
      line({ description: "C", quantity: 1, unitPrice: 10, vatAmount: 0 }),
    ];
    const result = allocateOrderDiscountToLines(lines, 10);
    assert.equal(result[0].discount, 3.33);
    assert.equal(result[1].discount, 3.33);
    assert.equal(result[2].discount, 3.34);
    assert.equal(
      roundMoney(result[0].discount + result[1].discount + result[2].discount),
      10,
    );
  });

  it("returns unchanged for empty lines or zero gross", () => {
    assert.deepEqual(allocateOrderDiscountToLines([], 10), []);
    const zero = [line({ description: "Z", quantity: 0, unitPrice: 0 })];
    assert.equal(allocateOrderDiscountToLines(zero, 5), zero);
  });

  it("does not recalculate vatAmount when allocating", () => {
    const lines = [
      line({ description: "A", quantity: 1, unitPrice: 100, vatRate: 5, vatAmount: 5 }),
    ];
    const result = allocateOrderDiscountToLines(lines, 20);
    assert.equal(result[0].discount, 20);
    assert.equal(result[0].vatAmount, 5);
    assert.equal(result[0].vatRate, 5);
    assert.equal(result[0].lineTotal, 85);
  });
});

describe("normalizeInvoiceDiscounts", () => {
  it("allocates when line discounts under-cover the order discount", () => {
    const lines = [
      line({ description: "A", quantity: 1, unitPrice: 50, vatAmount: 0 }),
      line({ description: "B", quantity: 1, unitPrice: 50, vatAmount: 0 }),
    ];
    const totals: InvoiceTotals = {
      subtotal: 100,
      discount: 20,
      vatTotal: 0,
      shipping: 0,
      grandTotal: 80,
    };
    const result = normalizeInvoiceDiscounts({ lineItems: lines, totals });
    assert.equal(result.changed, true);
    assert.equal(result.lineItems[0].discount, 10);
    assert.equal(result.lineItems[1].discount, 10);
  });

  it("raises subtotal to gross when understated and a discount exists", () => {
    const lines = [
      line({ description: "A", quantity: 2, unitPrice: 50, discount: 10, vatAmount: 0 }),
    ];
    const totals: InvoiceTotals = {
      subtotal: 80,
      discount: 10,
      vatTotal: 0,
      shipping: 0,
      grandTotal: 90,
    };
    const result = normalizeInvoiceDiscounts({ lineItems: lines, totals });
    assert.equal(result.changed, true);
    assert.equal(result.totals.subtotal, 100);
  });

  it("does not force subtotal when there is no order discount", () => {
    const lines = [line({ description: "A", quantity: 2, unitPrice: 50, vatAmount: 0 })];
    const totals: InvoiceTotals = {
      subtotal: 80,
      discount: 0,
      vatTotal: 0,
      shipping: 0,
      grandTotal: 100,
    };
    const result = normalizeInvoiceDiscounts({ lineItems: lines, totals });
    assert.equal(result.changed, false);
    assert.equal(result.totals.subtotal, 80);
  });
});

describe("alignVatRatesToAmounts", () => {
  it("clears invented 5% rate when vatAmount is zero", () => {
    const lines = [
      line({
        description: "A",
        quantity: 1,
        unitPrice: 100,
        discount: 10,
        vatRate: 5,
        vatAmount: 0,
        lineTotal: 95,
        productTitle: "Widget",
        barcode: "123",
      }),
    ];
    const totals: InvoiceTotals = {
      subtotal: 100,
      discount: 10,
      vatTotal: 0,
      shipping: 0,
      grandTotal: 90,
    };
    const result = alignVatRatesToAmounts({ lineItems: lines, totals });
    assert.equal(result.changed, true);
    assert.equal(result.lineItems[0].vatRate, 0);
    assert.equal(result.lineItems[0].vatAmount, 0);
    assert.equal(result.lineItems[0].lineTotal, 90);
    assert.equal(result.lineItems[0].productTitle, "Widget");
    assert.equal(result.lineItems[0].barcode, "123");
    assert.equal(result.totals?.vatTotal, 0);
  });

  it("does not clear a non-5% rate with zero tax", () => {
    const lines = [
      line({
        description: "A",
        quantity: 1,
        unitPrice: 100,
        vatRate: 10,
        vatAmount: 0,
        lineTotal: 100,
      }),
    ];
    const result = alignVatRatesToAmounts({ lineItems: lines, totals: null });
    assert.equal(result.changed, false);
    assert.equal(result.lineItems[0].vatRate, 10);
  });

  it("leaves real 5% tax amounts alone", () => {
    const lines = [
      line({
        description: "A",
        quantity: 1,
        unitPrice: 100,
        vatRate: 5,
        vatAmount: 5,
        lineTotal: 105,
      }),
    ];
    const result = alignVatRatesToAmounts({ lineItems: lines });
    assert.equal(result.changed, false);
    assert.equal(result.lineItems[0].vatRate, 5);
    assert.equal(result.lineItems[0].vatAmount, 5);
  });
});

describe("PINT line helpers", () => {
  it("computes line net preferring lineTotal - vatAmount", () => {
    assert.equal(
      lineNetAmountForItem({
        quantity: 1,
        unitPrice: 100,
        discount: 10,
        vatAmount: 5,
        lineTotal: 95,
      }),
      90,
    );
    assert.equal(
      lineNetAmountForItem({ quantity: 1, unitPrice: 50, discount: 60 }),
      0,
    );
  });

  it("maps rates to S and Z only", () => {
    assert.equal(taxCategoryForRate(5), "S");
    assert.equal(taxCategoryForRate(0), "Z");
    assert.equal(taxCategoryForRate(-1), "Z");
  });

  it("builds mixed-rate tax breakdown sorted by rate", () => {
    const lines = enrichLineItemsForPint([
      line({ description: "A", quantity: 1, unitPrice: 100, vatRate: 5, vatAmount: 5 }),
      line({ description: "B", quantity: 1, unitPrice: 50, vatRate: 0, vatAmount: 0 }),
      line({ description: "C", quantity: 2, unitPrice: 20, vatRate: 5, vatAmount: 2 }),
    ]);
    const breakdown = computeTaxBreakdown(lines);
    assert.equal(breakdown.length, 2);
    assert.equal(breakdown[0].rate, 0);
    assert.equal(breakdown[0].categoryCode, "Z");
    assert.equal(breakdown[0].taxableAmount, 50);
    assert.equal(breakdown[1].rate, 5);
    assert.equal(breakdown[1].categoryCode, "S");
    assert.equal(breakdown[1].taxableAmount, 140);
    assert.equal(breakdown[1].taxAmount, 7);
  });

  it("enriches lines with lineId, UoM, net, and category", () => {
    const enriched = enrichLineItemsForPint([
      line({ description: "A", quantity: 1, unitPrice: 100, vatRate: 5, vatAmount: 5 }),
    ]);
    assert.equal(enriched[0].lineId, "1");
    assert.equal(enriched[0].unitOfMeasure, "C62");
    assert.equal(enriched[0].lineNetAmount, 100);
    assert.equal(enriched[0].taxCategoryCode, "S");
  });
});

describe("buildPintMetadata and mapInvoiceToPintPayload", () => {
  it("builds metadata with shipping added to sum of line nets", () => {
    const lines = enrichLineItemsForPint([
      line({ description: "A", quantity: 1, unitPrice: 100, discount: 10, vatRate: 5, vatAmount: 4.5 }),
    ]);
    const totals: InvoiceTotals = {
      subtotal: 100,
      discount: 10,
      vatTotal: 4.5,
      shipping: 15,
      grandTotal: 109.5,
    };
    const meta = buildPintMetadata({
      issueDate: new Date("2026-01-15T12:00:00.000Z"),
      lineItems: lines,
      totals,
    });
    assert.equal(meta.invoiceTypeCode, "380");
    assert.equal(meta.sumLineNetAmount, 90);
    assert.equal(meta.totalWithoutTax, 105);
    assert.equal(meta.amountDue, 109.5);
    assert.equal(meta.taxBreakdown.length, 1);
    assert.equal(meta.specificationId, PINT_AE_SPECIFICATION_ID);
  });

  it("maps a full PINT payload including buyer/seller flatten", () => {
    const lines = enrichLineItemsForPint([
      line({
        description: "Widget",
        productTitle: "Premium Widget",
        quantity: 1,
        unitPrice: 100,
        vatRate: 5,
        vatAmount: 5,
      }),
    ]);
    const totals: InvoiceTotals = {
      subtotal: 100,
      discount: 0,
      vatTotal: 5,
      shipping: 0,
      grandTotal: 105,
    };
    const payload = mapInvoiceToPintPayload({
      invoiceNumber: "INV-1",
      issueDate: new Date("2026-03-01T00:00:00.000Z"),
      currency: "AED",
      seller: {
        legalName: "Acme LLC",
        trn: "100",
        address: { line1: "1 St", city: "Dubai", country: "AE" },
      },
      buyer: {
        name: "Jane",
        legalName: "Jane Co",
        email: "j@example.com",
        address: { line1: "2 St", city: "Dubai", country: "AE" },
      },
      lineItems: lines,
      totals,
    });
    assert.equal(payload.invoiceNumber, "INV-1");
    assert.equal(payload.issueDate, "2026-03-01");
    assert.equal(payload.seller.name, "Acme LLC");
    assert.equal(payload.buyer.name, "Jane Co");
    assert.equal(payload.lineItems[0].name, "Premium Widget");
    assert.equal(payload.lineItems[0].taxCategoryCode, "S");
    assert.equal(payload.taxBreakdown[0].rate, 5);
  });
});

describe("parseBuyerIdentifiersFromOrder", () => {
  it("reads TRN/TIN/legalName from note attributes and billing company", () => {
    const parsed = parseBuyerIdentifiersFromOrder({
      note_attributes: [
        { name: "Buyer_TRN", value: "123456789012345" },
        { name: "peppol_id", value: "AE:TIN:99" },
      ],
      billing_address: { company: "Buyer LLC" },
    });
    assert.equal(parsed.trn, "123456789012345");
    assert.equal(parsed.tin, "AE:TIN:99");
    assert.equal(parsed.legalName, "Buyer LLC");
  });
});

describe("discount + mixed VAT fixture", () => {
  it("matches allocate then enrich/breakdown totals", () => {
    const raw = [
      line({ description: "Taxed", quantity: 2, unitPrice: 50, vatRate: 5, vatAmount: 5 }),
      line({ description: "Zero", quantity: 1, unitPrice: 40, vatRate: 0, vatAmount: 0 }),
    ];
    const allocated = allocateOrderDiscountToLines(raw, 14);
    assert.equal(allocated[0].discount, 10);
    assert.equal(allocated[1].discount, 4);
    assert.equal(allocated[0].vatAmount, 5);
    assert.equal(allocated[0].lineTotal, 95);
    assert.equal(allocated[1].lineTotal, 36);

    const enriched = enrichLineItemsForPint(allocated);
    const breakdown = computeTaxBreakdown(enriched);
    assert.equal(breakdown.find((b) => b.rate === 0)?.taxableAmount, 36);
    assert.equal(breakdown.find((b) => b.rate === 5)?.taxableAmount, 90);
    assert.equal(breakdown.find((b) => b.rate === 5)?.taxAmount, 5);
  });
});
