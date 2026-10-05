import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Invoice } from "@prisma/client";

import prisma from "../app/db.server";
import {
  createCreditNoteFromRefund,
  mapRefundLineItems,
  parseCreditNoteLineItems,
  parseCreditNoteTotals,
  repairCreditNoteVat,
  resolveVatFromInvoice,
  sumCreditNoteTotals,
  type ShopifyRefund,
} from "../app/models/credit-note.server";
import { encryptSecret } from "../app/utils/token-crypto";
import type { InvoiceLineItem } from "../app/types/index";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.legalEntity.deleteMany({ where: { merchantId: row.merchantId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `store-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

function invoiceLine(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    sku: "SKU-A",
    description: "Widget — Blue",
    productTitle: "Widget",
    variantTitle: "Blue",
    imageUrl: "https://cdn.example/widget.jpg",
    barcode: "123456",
    quantity: 2,
    unitPrice: 100,
    discount: 0,
    vatRate: 5,
    vatAmount: 10,
    lineTotal: 210,
    ...overrides,
  };
}

async function seedInvoice(
  storeId: string,
  merchantId: string,
  opts?: {
    shopifyOrderId?: string;
    lineItems?: InvoiceLineItem[];
    currency?: string;
  },
): Promise<Invoice> {
  const orderId = opts?.shopifyOrderId ?? String(Math.floor(Math.random() * 1e9));
  return prisma.invoice.create({
    data: {
      merchantId,
      storeId,
      legalEntityId: merchantId,
      shopifyOrderId: orderId,
      shopifyOrderNumber: `#${orderId}`,
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      status: "generated",
      issueDate: new Date("2024-06-01T10:00:00Z"),
      currency: opts?.currency ?? "AED",
      seller: {
        legalName: "Acme Trading LLC",
        trn: "100000000000003",
        address: { line1: "Street 1", city: "Dubai", country: "AE" },
      },
      buyer: {
        name: "Ada Lovelace",
        email: "buyer@example.com",
      },
      lineItems: JSON.parse(
        JSON.stringify(opts?.lineItems ?? [invoiceLine()]),
      ) as object,
      totals: {
        subtotal: 200,
        discount: 0,
        vatTotal: 10,
        shipping: 0,
        grandTotal: 210,
      },
    },
  });
}

function baseRefund(
  orderId: number | string,
  overrides: Partial<ShopifyRefund> = {},
): ShopifyRefund {
  const id = overrides.id ?? Math.floor(Math.random() * 1e9);
  return {
    id,
    order_id: Number(orderId),
    created_at: "2024-07-01T12:00:00Z",
    note: "Customer return",
    refund_line_items: [
      {
        quantity: 1,
        subtotal: "100.00",
        total_tax: "5.00",
        line_item: {
          title: "Widget",
          name: "Widget",
          sku: "SKU-A",
          price: "100.00",
          variant_title: "Blue",
          tax_lines: [{ rate: 0.05, price: "5.00" }],
        },
      },
    ],
    ...overrides,
  };
}

describe("mapRefundLineItems / resolveVatFromInvoice", () => {
  it("matches by SKU and prefers invoice metadata", () => {
    const lines = [
      invoiceLine({ sku: "SKU-A", description: "Invoice Widget Desc" }),
      invoiceLine({ sku: "SKU-B", description: "Other" }),
    ];
    const mapped = mapRefundLineItems(
      {
        id: 1,
        order_id: 1,
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "100",
            total_tax: "5",
            line_item: {
              title: "Different Title",
              sku: "SKU-A",
              price: "100",
            },
          },
        ],
      },
      lines,
    );
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].description, "Invoice Widget Desc");
    assert.equal(mapped[0].sku, "SKU-A");
    assert.equal(mapped[0].imageUrl, "https://cdn.example/widget.jpg");
    assert.equal(mapped[0].discount, 0);
  });

  it("matches by normalized description when SKU missing", () => {
    const lines = [
      invoiceLine({ sku: "OTHER", description: "Premium Mug — White" }),
    ];
    const mapped = mapRefundLineItems(
      {
        id: 1,
        order_id: 1,
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "50",
            total_tax: "0",
            line_item: {
              title: "Premium Mug",
              variant_title: "White",
              price: "50",
            },
          },
        ],
      },
      lines,
    );
    assert.equal(mapped[0].description, "Premium Mug — White");
    assert.equal(mapped[0].vatRate, 5);
  });

  it("matches by title-prefix then sole-line fallback", () => {
    const prefixLines = [
      invoiceLine({
        sku: "X1",
        description: "Widget Extra Long Name",
        productTitle: "Widget",
      }),
      invoiceLine({ sku: "X2", description: "Gadget", productTitle: "Gadget" }),
    ];
    const byPrefix = mapRefundLineItems(
      {
        id: 1,
        order_id: 1,
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "10",
            total_tax: "0",
            line_item: { title: "Widget", price: "10" },
          },
        ],
      },
      prefixLines,
    );
    assert.equal(byPrefix[0].description, "Widget Extra Long Name");

    const sole = [
      invoiceLine({ sku: "ONLY", description: "Only Item", vatRate: 5, vatAmount: 5 }),
    ];
    const bySole = mapRefundLineItems(
      {
        id: 2,
        order_id: 1,
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "100",
            total_tax: "0",
            line_item: { title: "Unrelated Name", price: "100" },
          },
        ],
      },
      sole,
    );
    assert.equal(bySole[0].description, "Only Item");
  });

  it("keeps unmatched multi-line refund as its own line", () => {
    const lines = [
      invoiceLine({ sku: "A", description: "Alpha" }),
      invoiceLine({ sku: "B", description: "Beta" }),
    ];
    const mapped = mapRefundLineItems(
      {
        id: 1,
        order_id: 1,
        refund_line_items: [
          {
            quantity: 2,
            subtotal: "40",
            total_tax: "2",
            line_item: {
              title: "Unknown Product",
              sku: "NO-MATCH",
              price: "20",
            },
          },
        ],
      },
      lines,
    );
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].description, "Unknown Product");
    assert.equal(mapped[0].quantity, 2);
    assert.equal(mapped[0].unitPrice, 20);
    assert.equal(mapped[0].vatAmount, 2);
  });

  it("uses quantity || 1 and prorates invoice VAT when Shopify tax is 0", () => {
    const vat = resolveVatFromInvoice(
      [invoiceLine({ quantity: 2, vatAmount: 10, vatRate: 5 })],
      {
        quantity: 0,
        total_tax: "0",
        line_item: { sku: "SKU-A", title: "Widget", tax_lines: [] },
      },
      100,
      0,
    );
    // quantity || 1 → 1; 10/2 * 1 = 5
    assert.equal(vat.vatRate, 5);
    assert.equal(vat.vatAmount, 5);
  });

  it("falls back to Shopify tax-line rate then tax/subtotal", () => {
    const noMatch: InvoiceLineItem[] = [
      invoiceLine({ sku: "Z", description: "Z" }),
      invoiceLine({ sku: "Y", description: "Y" }),
    ];
    const fromTaxLines = resolveVatFromInvoice(
      noMatch,
      {
        quantity: 1,
        line_item: {
          title: "NoMatch",
          tax_lines: [{ rate: 0.05 }],
        },
      },
      100,
      0,
    );
    assert.equal(fromTaxLines.vatRate, 5);

    const fromRatio = resolveVatFromInvoice(
      noMatch,
      { quantity: 1, line_item: { title: "NoMatch" } },
      100,
      5,
    );
    assert.equal(fromRatio.vatRate, 5);
    assert.equal(fromRatio.vatAmount, 5);
  });

  it("does not invent VAT from rate alone when amounts are zero", () => {
    const vat = resolveVatFromInvoice(
      [
        invoiceLine({
          sku: "SKU-A",
          vatRate: 5,
          vatAmount: 0,
          quantity: 1,
        }),
      ],
      {
        quantity: 1,
        line_item: { sku: "SKU-A", title: "Widget", tax_lines: [{ rate: 0.05 }] },
      },
      100,
      0,
    );
    assert.equal(vat.vatRate, 5);
    assert.equal(vat.vatAmount, 0);
  });

  it("builds adjustment line from transactions and throws path when empty", () => {
    const withTax = mapRefundLineItems(
      {
        id: 1,
        order_id: 1,
        note: "Shipping refund",
        refund_line_items: [],
        transactions: [{ amount: "21.00" }],
        order_adjustments: [{ tax_amount: "-1.00" }],
      },
      [invoiceLine({ vatRate: 5 })],
    );
    assert.equal(withTax.length, 1);
    assert.equal(withTax[0].description, "Shipping refund");
    assert.equal(withTax[0].vatAmount, 1);
    assert.equal(withTax[0].unitPrice, 20);
    assert.equal(withTax[0].lineTotal, 21);

    const viaRate = mapRefundLineItems(
      {
        id: 2,
        order_id: 1,
        refund_line_items: [],
        transactions: [{ amount: "105.00" }],
        order_adjustments: [],
      },
      [invoiceLine({ vatRate: 5 })],
    );
    assert.equal(viaRate[0].description, "Refund adjustment");
    assert.ok(Math.abs(viaRate[0].unitPrice - 100) < 0.01);
    assert.ok(Math.abs(viaRate[0].vatAmount - 5) < 0.01);

    const empty = mapRefundLineItems(
      {
        id: 3,
        order_id: 1,
        refund_line_items: [],
        transactions: [{ amount: "0" }],
        order_adjustments: [{ tax_amount: "0" }],
      },
      [],
    );
    assert.equal(empty.length, 0);
  });

  it("sumCreditNoteTotals sets shipping discount 0", () => {
    const totals = sumCreditNoteTotals([
      {
        description: "A",
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 5,
        vatAmount: 5,
        lineTotal: 105,
      },
    ]);
    assert.equal(totals.subtotal, 100);
    assert.equal(totals.vatTotal, 5);
    assert.equal(totals.grandTotal, 105);
    assert.equal(totals.shipping, 0);
    assert.equal(totals.discount, 0);
  });
});

describe("createCreditNoteFromRefund", () => {
  it("creates a credit note with header fields, totals, and status event", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId, {
      note: "  Defective item  ",
      created_at: "2024-08-15T09:30:00Z",
    });

    const note = await createCreditNoteFromRefund(
      store.shopifyDomain,
      refund,
      "webhook",
    );
    assert.ok(note);
    assert.equal(note!.invoiceId, invoice.id);
    assert.equal(note!.shopifyRefundId, String(refund.id));
    assert.equal(note!.creditNoteNumber, "CN-00001");
    assert.equal(note!.status, "generated");
    assert.equal(note!.reason, "Defective item");
    assert.equal(note!.issueDate.toISOString(), "2024-08-15T09:30:00.000Z");
    assert.equal(note!.currency, "AED");

    const lines = parseCreditNoteLineItems(note!);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].discount, 0);
    assert.equal(lines[0].quantity, 1);

    const totals = parseCreditNoteTotals(note!);
    assert.equal(totals.shipping, 0);
    assert.equal(totals.discount, 0);
    assert.equal(totals.subtotal, 100);
    assert.equal(totals.vatTotal, 5);
    assert.equal(totals.grandTotal, 105);

    const seller = note!.seller as { legalName?: string };
    const buyer = note!.buyer as { name?: string };
    assert.equal(seller.legalName, "Acme Trading LLC");
    assert.equal(buyer.name, "Ada Lovelace");

    const events = await prisma.invoiceStatusEvent.findMany({
      where: { creditNoteId: note!.id },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "generated");
    assert.equal(events[0].source, "shopify");
    assert.equal(events[0].invoiceId, invoice.id);
  });

  it("uses sync→merchant source and default reason", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId, { note: null });
    const note = await createCreditNoteFromRefund(
      store.shopifyDomain,
      refund,
      "sync",
    );
    assert.equal(note!.reason, "Refund / return");
    const event = await prisma.invoiceStatusEvent.findFirst({
      where: { creditNoteId: note!.id },
    });
    assert.equal(event?.source, "merchant");
  });

  it("returns null when no invoice exists and does not create a credit note", async () => {
    const { store } = await seedStore();
    const result = await createCreditNoteFromRefund(
      store.shopifyDomain,
      baseRefund(999999001),
    );
    assert.equal(result, null);
    const count = await prisma.creditNote.count({ where: { storeId: store.id } });
    assert.equal(count, 0);
  });

  it("returns null for inactive/missing store", async () => {
    const result = await createCreditNoteFromRefund(
      "missing.myshopify.com",
      baseRefund(1),
    );
    assert.equal(result, null);
  });

  it("is idempotent for the same shopifyRefundId and does not duplicate events", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId);

    const first = await createCreditNoteFromRefund(store.shopifyDomain, refund);
    const second = await createCreditNoteFromRefund(store.shopifyDomain, refund);
    assert.ok(first && second);
    assert.equal(first!.id, second!.id);

    const notes = await prisma.creditNote.count({ where: { storeId: store.id } });
    assert.equal(notes, 1);
    const events = await prisma.invoiceStatusEvent.count({
      where: { creditNoteId: first!.id },
    });
    assert.equal(events, 1);
  });

  it("resolves concurrent creates via unique constraint", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId);

    const [a, b] = await Promise.all([
      createCreditNoteFromRefund(store.shopifyDomain, refund, "webhook"),
      createCreditNoteFromRefund(store.shopifyDomain, refund, "sync"),
    ]);
    assert.ok(a && b);
    assert.equal(a!.id, b!.id);
    assert.equal(
      await prisma.creditNote.count({ where: { storeId: store.id } }),
      1,
    );
    assert.equal(
      await prisma.invoiceStatusEvent.count({
        where: { creditNoteId: a!.id },
      }),
      1,
    );
  });

  it("supports multiple refunds on the same invoice", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const r1 = await createCreditNoteFromRefund(
      store.shopifyDomain,
      baseRefund(invoice.shopifyOrderId, { id: 1001 }),
    );
    const r2 = await createCreditNoteFromRefund(
      store.shopifyDomain,
      baseRefund(invoice.shopifyOrderId, { id: 1002 }),
    );
    assert.ok(r1 && r2);
    assert.notEqual(r1!.id, r2!.id);
    assert.equal(r1!.creditNoteNumber, "CN-00001");
    assert.equal(r2!.creditNoteNumber, "CN-00002");
  });

  it("throws for zero-value adjustment refunds", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    await assert.rejects(
      () =>
        createCreditNoteFromRefund(store.shopifyDomain, {
          id: 55,
          order_id: Number(invoice.shopifyOrderId),
          refund_line_items: [],
          transactions: [{ amount: "0" }],
          order_adjustments: [],
        }),
      /no refundable line items or amounts/,
    );
    assert.equal(
      await prisma.creditNote.count({ where: { storeId: store.id } }),
      0,
    );
  });

  it("creates adjustment credit note when refund lines are empty", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const note = await createCreditNoteFromRefund(store.shopifyDomain, {
      id: 77,
      order_id: Number(invoice.shopifyOrderId),
      note: "Shipping only",
      refund_line_items: [],
      transactions: [{ amount: "10.50" }],
      order_adjustments: [{ tax_amount: "0.50" }],
    });
    assert.ok(note);
    const lines = parseCreditNoteLineItems(note!);
    assert.equal(lines[0].description, "Shipping only");
    assert.equal(lines[0].vatAmount, 0.5);
  });

  it("partial refund uses refund quantity only", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, {
      lineItems: [invoiceLine({ quantity: 5, vatAmount: 25, unitPrice: 100 })],
    });
    const note = await createCreditNoteFromRefund(
      store.shopifyDomain,
      baseRefund(invoice.shopifyOrderId, {
        refund_line_items: [
          {
            quantity: 2,
            subtotal: "200",
            total_tax: "0",
            line_item: {
              sku: "SKU-A",
              title: "Widget",
              price: "100",
            },
          },
        ],
      }),
    );
    const lines = parseCreditNoteLineItems(note!);
    assert.equal(lines[0].quantity, 2);
    // prorate 25/5 * 2 = 10
    assert.equal(lines[0].vatAmount, 10);
  });
});

describe("repairCreditNoteVat", () => {
  it("repairs 0/0 and 5/0 lines from invoice VAT", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, {
      lineItems: [
        invoiceLine({
          sku: "SKU-A",
          quantity: 2,
          vatRate: 5,
          vatAmount: 10,
          unitPrice: 100,
        }),
      ],
    });

    const broken = await prisma.creditNote.create({
      data: {
        merchantId: merchant.id,
        storeId: store.id,
        invoiceId: invoice.id,
        shopifyRefundId: `repair-${randomUUID()}`,
        shopifyOrderId: invoice.shopifyOrderId,
        creditNoteNumber: `CN-R-${randomUUID().slice(0, 6)}`,
        status: "generated",
        issueDate: new Date(),
        currency: "AED",
        seller: invoice.seller as object,
        buyer: invoice.buyer as object,
        lineItems: [
          {
            sku: "SKU-A",
            description: "Widget — Blue",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
            lineTotal: 100,
          },
          {
            sku: "SKU-A",
            description: "Widget — Blue",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            vatRate: 5,
            vatAmount: 0,
            lineTotal: 100,
          },
        ],
        totals: {
          subtotal: 200,
          discount: 0,
          vatTotal: 0,
          shipping: 0,
          grandTotal: 200,
        },
      },
    });

    await repairCreditNoteVat(broken.id, [
      invoiceLine({
        sku: "SKU-A",
        quantity: 2,
        vatRate: 5,
        vatAmount: 10,
      }),
    ]);

    const updated = await prisma.creditNote.findUniqueOrThrow({
      where: { id: broken.id },
    });
    const lines = parseCreditNoteLineItems(updated);
    assert.equal(lines[0].vatRate, 5);
    assert.equal(lines[0].vatAmount, 5);
    assert.equal(lines[0].lineTotal, 105);
    assert.equal(lines[1].vatRate, 5);
    assert.equal(lines[1].vatAmount, 5);
    assert.equal(lines[1].lineTotal, 105);
    const totals = parseCreditNoteTotals(updated);
    assert.equal(totals.vatTotal, 10);
    assert.equal(totals.grandTotal, 210);
  });
});
