import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Invoice } from "@prisma/client";

import prisma from "../app/db.server";
import {
  buildLineItemsFromShopifyOrder,
  createInvoiceFromShopifyOrder,
  handleOrderCreated,
  repairInvoiceDiscountAlignment,
  repairInvoiceVatAlignedToAmounts,
  restoreEnrichLineItemsForTests,
  setEnrichLineItemsForTests,
  type ShopifyOrder,
} from "../app/models/invoice-create.server";
import { syncOrdersForShop } from "../app/models/order-sync.server";
import {
  restoreDocumentEmailHooks,
  setDocumentEmailHooks,
} from "../app/models/document-email.server";
import { encryptSecret } from "../app/utils/token-crypto";
import type { InvoiceLineItem, InvoiceTotals } from "../app/types/index";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.legalEntity.deleteMany({ where: { merchantId: row.merchantId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  restoreDocumentEmailHooks();
  restoreEnrichLineItemsForTests();
});

async function seedStore(opts?: {
  withLegalEntity?: boolean;
  invoiceMode?: string;
}) {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `store-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: opts?.invoiceMode ?? "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });

  let legalEntityId: string | undefined;
  if (opts?.withLegalEntity !== false) {
    const entity = await prisma.legalEntity.create({
      data: {
        merchantId: merchant.id,
        legalName: "Acme Trading LLC",
        trn: "100000000000003",
        tin: "1000000000",
        businessEmail: "billing@acme.test",
        address: {
          line1: "Street 1",
          city: "Dubai",
          emirate: "Dubai",
          country: "AE",
        },
        emirate: "Dubai",
        isDefault: true,
      },
    });
    legalEntityId = entity.id;
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultLegalEntityId: entity.id },
    });
  }

  return { merchant, store, legalEntityId };
}

function baseOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  const id = overrides.id ?? Math.floor(Math.random() * 1_000_000_000);
  return {
    id,
    order_number: id,
    name: overrides.name ?? `#${id}`,
    email: "buyer@example.com",
    currency: "AED",
    financial_status: "pending",
    total_price: "105.00",
    subtotal_price: "100.00",
    total_tax: "5.00",
    total_discounts: "0.00",
    total_shipping_price_set: { shop_money: { amount: "0.00" } },
    created_at: "2024-06-15T10:00:00Z",
    customer: {
      id: 1,
      first_name: "Ada",
      last_name: "Lovelace",
      email: "buyer@example.com",
      phone: "+971500000000",
    },
    billing_address: {
      name: "Ada Lovelace",
      address1: "1 Marina",
      city: "Dubai",
      province: "Dubai",
      country_code: "AE",
      phone: "+971500000000",
    },
    shipping_address: {
      name: "Ada Lovelace",
      address1: "1 Marina",
      city: "Dubai",
      province: "Dubai",
      country_code: "AE",
    },
    shipping_lines: [{ title: "Standard" }],
    line_items: [
      {
        sku: "SKU-1",
        title: "Widget",
        variant_title: "Blue",
        variant_id: 111,
        product_id: 222,
        quantity: 1,
        price: "100.00",
        total_discount: "0.00",
        tax_lines: [{ rate: 0.05, price: "5.00" }],
      },
    ],
    ...overrides,
  };
}

/** Skip Shopify GraphQL enrichment in unit tests. */
async function passthroughEnrich<T>(
  _shop: string,
  _orderLines: unknown[],
  lineItems: T[],
): Promise<T[]> {
  return lineItems;
}

function linesOf(invoice: Invoice): InvoiceLineItem[] {
  return invoice.lineItems as unknown as InvoiceLineItem[];
}

function totalsOf(invoice: Invoice): InvoiceTotals {
  return invoice.totals as unknown as InvoiceTotals;
}

describe("buildLineItemsFromShopifyOrder", () => {
  it("maps tax, variants, and allocates order-level discounts", () => {
    const order = baseOrder({
      total_discounts: "10.00",
      line_items: [
        {
          title: "A",
          variant_title: "Large",
          quantity: 1,
          price: "50.00",
          total_discount: "0.00",
          tax_lines: [{ rate: 0.05, price: "2.00" }],
        },
        {
          title: "B",
          quantity: 1,
          price: "50.00",
          total_discount: "0.00",
          tax_lines: [{ rate: 0, price: "0.00" }],
        },
      ],
    });
    const lines = buildLineItemsFromShopifyOrder(order);
    assert.equal(lines.length, 2);
    const discountSum = lines.reduce((s, l) => s + (l.discount || 0), 0);
    assert.ok(Math.abs(discountSum - 10) < 0.02);
    assert.equal(lines[0].description, "A ? Large");
    assert.equal(lines[0].vatRate, 5);
    assert.equal(lines[1].vatRate, 0);
  });
});

describe("createInvoiceFromShopifyOrder", () => {
  it("creates a normal invoice with seller snapshot, PINT, and status event", async () => {
    const { store, legalEntityId } = await seedStore();
    const order = baseOrder({ id: 900001, name: "#900001" });

    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );

    assert.ok(invoice);
    assert.equal(invoice!.shopifyOrderId, "900001");
    assert.equal(invoice!.shopifyOrderNumber, "#900001");
    assert.equal(invoice!.status, "generated");
    assert.equal(invoice!.mode, "standard");
    assert.equal(invoice!.currency, "AED");
    assert.equal(invoice!.legalEntityId, legalEntityId);
    assert.equal(invoice!.defaultTemplateId, null);
    assert.equal(invoice!.invoiceNumber, "INV-00001");

    const seller = invoice!.seller as { legalName: string; trn?: string };
    assert.equal(seller.legalName, "Acme Trading LLC");
    assert.equal(seller.trn, "100000000000003");

    const buyer = invoice!.buyer as { name: string; email?: string };
    assert.equal(buyer.name, "Ada Lovelace");
    assert.equal(buyer.email, "buyer@example.com");

    const totals = totalsOf(invoice!);
    assert.equal(totals.subtotal, 100);
    assert.equal(totals.vatTotal, 5);
    assert.equal(totals.grandTotal, 105);
    assert.ok(totals.amountDue != null);
    assert.ok(totals.totalWithoutTax != null);

    const pint = invoice!.pint as { invoiceTypeCode?: string };
    assert.ok(pint?.invoiceTypeCode);

    const events = await prisma.invoiceStatusEvent.findMany({
      where: { invoiceId: invoice!.id },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "generated");
    assert.equal(events[0].source, "shopify");
  });

  it("does not create a duplicate for the same order", async () => {
    const { store } = await seedStore();
    const order = baseOrder({ id: 900002 });
    const a = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    const b = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "sync",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(a!.id, b!.id);
    const count = await prisma.invoice.count({
      where: { storeId: store.id, shopifyOrderId: "900002" },
    });
    assert.equal(count, 1);
  });

  it("resolves concurrent creates via unique constraint (P2002)", async () => {
    const { store } = await seedStore();
    const order = baseOrder({ id: 900003, name: "#900003" });

    const results = await Promise.all([
      createInvoiceFromShopifyOrder(store.shopifyDomain, order, "webhook", {
        enrichLineItems: passthroughEnrich,
      }),
      createInvoiceFromShopifyOrder(store.shopifyDomain, order, "sync", {
        enrichLineItems: passthroughEnrich,
      }),
    ]);

    assert.ok(results[0]);
    assert.ok(results[1]);
    assert.equal(results[0]!.id, results[1]!.id);
    const count = await prisma.invoice.count({
      where: { storeId: store.id, shopifyOrderId: "900003" },
    });
    assert.equal(count, 1);
  });

  it("P2002 race: create wins unpaid then paid loser marks invoice paid", async () => {
    const { store } = await seedStore();
    const unpaid = baseOrder({
      id: 900050,
      name: "#900050",
      financial_status: "pending",
    });
    const paid = { ...unpaid, financial_status: "paid" };

    let releasePaidEnrich!: () => void;
    const paidEnrichGate = new Promise<void>((resolve) => {
      releasePaidEnrich = resolve;
    });

    // Paid passes the find-before-create check, then waits in enrichment.
    const paidPromise = createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      paid,
      "webhook",
      {
        orderIsPaid: true,
        enrichLineItems: async (_shop, _lines, items) => {
          await paidEnrichGate;
          return items;
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    // Unpaid creates first while paid is still gated → unpaid wins insert.
    const unpaidResult = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      unpaid,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(unpaidResult!.financialStatus, "pending");

    releasePaidEnrich();
    const paidResult = await paidPromise;

    assert.equal(paidResult!.id, unpaidResult!.id);
    assert.equal(paidResult!.financialStatus, "paid");

    const final = await prisma.invoice.findUnique({
      where: { id: unpaidResult!.id },
    });
    assert.equal(final!.financialStatus, "paid");
    assert.equal(
      await prisma.invoice.count({
        where: { storeId: store.id, shopifyOrderId: "900050" },
      }),
      1,
    );
  });

  it("paid request on existing invoice remains paid", async () => {
    const { store } = await seedStore();
    const order = baseOrder({
      id: 900051,
      name: "#900051",
      financial_status: "paid",
    });
    const first = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich, orderIsPaid: true },
    );
    assert.equal(first!.financialStatus, "paid");

    const second = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich, orderIsPaid: true },
    );
    assert.equal(second!.id, first!.id);
    assert.equal(second!.financialStatus, "paid");
    assert.equal(
      await prisma.invoice.count({
        where: { storeId: store.id, shopifyOrderId: "900051" },
      }),
      1,
    );
  });

  it("duplicate unpaid create does not unnecessarily change financialStatus", async () => {
    const { store } = await seedStore();
    const order = baseOrder({
      id: 900052,
      name: "#900052",
      financial_status: "pending",
    });
    const first = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(first!.financialStatus, "pending");
    const before = await prisma.invoice.findUnique({ where: { id: first!.id } });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(second!.id, first!.id);
    assert.equal(second!.financialStatus, "pending");

    const after = await prisma.invoice.findUnique({ where: { id: first!.id } });
    assert.equal(after!.financialStatus, "pending");
    assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime());
  });

  it("returns null when store is missing", async () => {
    const order = baseOrder({ id: 900004 });
    const result = await createInvoiceFromShopifyOrder(
      "missing-shop.myshopify.com",
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(result, null);
  });

  it("throws when order has no line items", async () => {
    const { store } = await seedStore();
    const order = baseOrder({ id: 900005, line_items: [] });
    await assert.rejects(
      () =>
        createInvoiceFromShopifyOrder(store.shopifyDomain, order, "webhook", {
          enrichLineItems: passthroughEnrich,
        }),
      /no line items/,
    );
  });

  it("defaults buyer name when customer is missing", async () => {
    const { store } = await seedStore();
    const order = baseOrder({
      id: 900006,
      customer: undefined,
      billing_address: undefined,
      shipping_address: undefined,
      email: "anon@example.com",
    });
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    const buyer = invoice!.buyer as { name: string; email?: string };
    assert.equal(buyer.name, "Customer");
    assert.equal(buyer.email, "anon@example.com");
  });

  it("survives enrichment failure by keeping built line items", async () => {
    const { store } = await seedStore();
    const order = baseOrder({ id: 900007 });
    // Old behavior: GraphQL failure → empty map → return lines unchanged.
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      {
        enrichLineItems: async (_shop, _lines, items) => items,
      },
    );
    assert.ok(invoice);
    assert.equal(linesOf(invoice!).length, 1);
    assert.match(linesOf(invoice!)[0].description, /Widget/);
  });

  it("maps mixed VAT, discounts, and shipping", async () => {
    const { store } = await seedStore();
    const order = baseOrder({
      id: 900009,
      total_discounts: "5.00",
      total_tax: "4.75",
      total_price: "109.75",
      total_shipping_price_set: { shop_money: { amount: "10.00" } },
      line_items: [
        {
          title: "Taxed",
          quantity: 1,
          price: "50.00",
          total_discount: "0.00",
          tax_lines: [{ rate: 0.05, price: "2.25" }],
        },
        {
          title: "Zero",
          quantity: 1,
          price: "50.00",
          total_discount: "0.00",
          tax_lines: [{ rate: 0, price: "0.00" }],
        },
      ],
    });
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    const totals = totalsOf(invoice!);
    assert.equal(totals.shipping, 10);
    assert.equal(totals.discount, 5);
    assert.equal(totals.subtotal, 100);
    assert.equal(totals.vatTotal, 4.75);
    assert.equal(totals.grandTotal, 109.75);
    const rates = linesOf(invoice!).map((l) => l.vatRate);
    assert.ok(rates.some((r) => r === 5));
    assert.ok(rates.some((r) => r === 0));
  });

  it("parses buyer TRN/TIN from note attributes", async () => {
    const { store } = await seedStore();
    const order = baseOrder({
      id: 900010,
      note_attributes: [
        { name: "buyer_trn", value: "100299999999993" },
        { name: "buyer_tin", value: "TIN-999" },
      ],
      billing_address: {
        company: "Buyer Co",
        address1: "Road",
        city: "Dubai",
        country_code: "AE",
      },
    });
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    const buyer = invoice!.buyer as {
      trn?: string;
      tin?: string;
      legalName?: string;
    };
    assert.equal(buyer.trn, "100299999999993");
    assert.equal(buyer.tin, "TIN-999");
    assert.equal(buyer.legalName, "Buyer Co");
  });

  it("uses merchantId as legalEntityId when no LegalEntity exists", async () => {
    const { store, merchant } = await seedStore({ withLegalEntity: false });
    const order = baseOrder({ id: 900011 });
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(invoice!.legalEntityId, merchant.id);
    const seller = invoice!.seller as { legalName: string; address: { country: string } };
    assert.equal(seller.legalName, store.shopifyDomain);
    assert.equal(seller.address.country, "AE");
  });

  it("leaves defaultTemplateId unset", async () => {
    const { store } = await seedStore();
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      baseOrder({ id: 900012 }),
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(invoice!.defaultTemplateId, null);
  });

  it("enforces invoice-number uniqueness per legal entity", async () => {
    const { store, legalEntityId } = await seedStore();
    await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      baseOrder({ id: 900013 }),
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      baseOrder({ id: 900014 }),
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    const nums = await prisma.invoice.findMany({
      where: { legalEntityId: legalEntityId! },
      select: { invoiceNumber: true },
    });
    const unique = new Set(nums.map((n) => n.invoiceNumber));
    assert.equal(unique.size, nums.length);
  });

  it("invokes email hook on create without sending mail", async () => {
    const { store } = await seedStore();
    const calls: Array<{ shop: string; id: string; paid: boolean }> = [];
    setDocumentEmailHooks({
      scheduleInvoiceAutoEmail: async (shop, id, paid) => {
        calls.push({ shop, id, paid });
      },
    });
    const order = baseOrder({ id: 900015, financial_status: "paid" });
    const invoice = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      order,
      "webhook",
      { enrichLineItems: passthroughEnrich, orderIsPaid: true },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, invoice!.id);
    assert.equal(calls[0].paid, true);
  });
});

describe("existing invoice repair", () => {
  it("repairs invented 5% VAT with zero amount", async () => {
    const { store, merchant } = await seedStore({ withLegalEntity: false });
    const invoice = await prisma.invoice.create({
      data: {
        merchantId: merchant.id,
        storeId: store.id,
        legalEntityId: merchant.id,
        shopifyOrderId: "repair-vat-1",
        invoiceNumber: "INV-R001",
        issueDate: new Date(),
        seller: { legalName: "X", address: { line1: "", city: "", country: "" } },
        buyer: { name: "Y" },
        lineItems: [
          {
            description: "Item",
            quantity: 1,
            unitPrice: 10,
            discount: 0,
            vatRate: 5,
            vatAmount: 0,
            lineTotal: 10,
          },
        ],
        totals: {
          subtotal: 10,
          discount: 0,
          vatTotal: 0,
          shipping: 0,
          grandTotal: 10,
        },
      },
    });

    const repaired = await repairInvoiceVatAlignedToAmounts(invoice.id);
    const line = linesOf(repaired!)[0];
    assert.equal(line.vatRate, 0);
    assert.equal(line.vatAmount, 0);
  });

  it("repairs discount alignment on existing invoice", async () => {
    const { store, merchant } = await seedStore({ withLegalEntity: false });
    const invoice = await prisma.invoice.create({
      data: {
        merchantId: merchant.id,
        storeId: store.id,
        legalEntityId: merchant.id,
        shopifyOrderId: "repair-disc-1",
        invoiceNumber: "INV-R002",
        issueDate: new Date(),
        seller: { legalName: "X", address: { line1: "", city: "", country: "" } },
        buyer: { name: "Y" },
        lineItems: [
          {
            description: "A",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
            lineTotal: 100,
          },
        ],
        totals: {
          subtotal: 90,
          discount: 10,
          vatTotal: 0,
          shipping: 0,
          grandTotal: 90,
        },
      },
    });

    const repaired = await repairInvoiceDiscountAlignment(invoice.id);
    assert.ok(repaired);
    assert.equal(linesOf(repaired!)[0].discount, 10);
    assert.equal(totalsOf(repaired!).subtotal, 100);
  });

  it("updates financial status on existing invoice", async () => {
    const { store } = await seedStore();
    const order = baseOrder({ id: 900020, financial_status: "pending" });
    await createInvoiceFromShopifyOrder(store.shopifyDomain, order, "webhook", {
      enrichLineItems: passthroughEnrich,
    });
    const updated = await createInvoiceFromShopifyOrder(
      store.shopifyDomain,
      { ...order, financial_status: "paid" },
      "webhook",
      { enrichLineItems: passthroughEnrich },
    );
    assert.equal(updated!.financialStatus, "paid");
  });
});

describe("webhooks handleOrderCreated", () => {
  it("orders/create inserts an invoice", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store } = await seedStore();
    const order = baseOrder({ id: 900030, financial_status: "pending" });
    const invoice = await handleOrderCreated(
      store.shopifyDomain,
      order,
      "orders/create",
    );
    assert.ok(invoice);
    assert.equal(invoice!.financialStatus, "pending");
  });

  it("orders/paid creates if missing (paid before create)", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store } = await seedStore();
    const order = baseOrder({ id: 900031, financial_status: "paid" });
    const invoice = await handleOrderCreated(
      store.shopifyDomain,
      order,
      "orders/paid",
    );
    assert.ok(invoice);
    assert.equal(invoice!.financialStatus, "paid");
  });

  it("duplicate webhook does not create a second invoice and invokes paid email hook", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store } = await seedStore();
    const order = baseOrder({ id: 900032, financial_status: "pending" });
    await handleOrderCreated(store.shopifyDomain, order, "orders/create");

    const paidCalls: string[] = [];
    setDocumentEmailHooks({
      scheduleInvoiceAutoEmailOnPaid: async (_shop, id) => {
        paidCalls.push(id);
      },
    });

    const again = await handleOrderCreated(
      store.shopifyDomain,
      { ...order, financial_status: "paid" },
      "orders/paid",
    );
    assert.ok(again);
    const count = await prisma.invoice.count({
      where: { storeId: store.id, shopifyOrderId: "900032" },
    });
    assert.equal(count, 1);
    assert.equal(again!.financialStatus, "paid");
    assert.equal(paidCalls.length, 1);
  });
});

describe("syncOrdersForShop", () => {
  it("creates missing invoices and skips existing", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store } = await seedStore();
    const existing = baseOrder({ id: 900040, name: "#900040" });
    await createInvoiceFromShopifyOrder(store.shopifyDomain, existing, "sync", {
      enrichLineItems: passthroughEnrich,
    });

    const missing = baseOrder({ id: 900041, name: "#900041" });
    const result = await syncOrdersForShop(store.shopifyDomain, 50, {
      getOfflineAccessTokenForShop: async () => "fake-token",
      fetchRecentOrders: async () => [existing, missing],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.fetched, 2);
      assert.equal(result.created, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.failed, 0);
    }
  });

  it("continues after one order fails", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store } = await seedStore();
    const bad = baseOrder({ id: 900042, name: "#900042", line_items: [] });
    const good = baseOrder({ id: 900043, name: "#900043" });

    const result = await syncOrdersForShop(store.shopifyDomain, 50, {
      getOfflineAccessTokenForShop: async () => "fake-token",
      fetchRecentOrders: async () => [bad, good],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.created, 1);
      assert.equal(result.failed, 1);
      assert.ok(result.errors.length >= 1);
    }
  });

  it("returns needsReauth when session is missing", async () => {
    const { store } = await seedStore();
    const result = await syncOrdersForShop(store.shopifyDomain, 50, {
      getOfflineAccessTokenForShop: async () => null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.needsReauth, true);
    }
  });
});
