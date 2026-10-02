import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  CSV_EXPORT_LIMIT,
  exportAllInvoicesForShop,
  invoiceListHasFilters,
  invoicesToCsv,
  listInvoicesForShop,
  parseInvoiceListQuery,
} from "../app/models/invoice-list.server";
import { enqueueSyncOrders } from "../app/models/sync-queue.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `shop-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

async function createInvoice(
  store: { id: string; merchantId: string; currency: string },
  opts: {
    invoiceNumber: string;
    shopifyOrderId: string;
    shopifyOrderNumber?: string;
    status?: string;
    financialStatus?: string | null;
    issueDate?: Date;
    buyerName?: string;
    buyerEmail?: string;
    grandTotal?: number;
  },
) {
  return prisma.invoice.create({
    data: {
      merchantId: store.merchantId,
      storeId: store.id,
      legalEntityId: store.merchantId,
      shopifyOrderId: opts.shopifyOrderId,
      shopifyOrderNumber: opts.shopifyOrderNumber ?? `#${opts.shopifyOrderId}`,
      invoiceNumber: opts.invoiceNumber,
      status: opts.status ?? "generated",
      financialStatus: opts.financialStatus ?? "pending",
      issueDate: opts.issueDate ?? new Date("2024-06-15T10:00:00Z"),
      currency: store.currency,
      seller: {
        legalName: "Seller",
        address: { line1: "A", city: "Dubai", country: "AE" },
      },
      buyer: {
        name: opts.buyerName ?? "Ada Lovelace",
        email: opts.buyerEmail ?? "ada@example.com",
        phone: "+971500000000",
      },
      lineItems: [
        {
          description: "Item",
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          vatRate: 5,
          vatAmount: 5,
          lineTotal: 105,
        },
      ],
      totals: {
        subtotal: 100,
        discount: 0,
        vatTotal: 5,
        shipping: 0,
        grandTotal: opts.grandTotal ?? 105,
      },
    },
  });
}

describe("parseInvoiceListQuery", () => {
  it("parses search, status groups, payment status, dates, pagination", () => {
    const q = parseInvoiceListQuery({
      q: "  INV-1  ",
      status: "group:pending",
      paymentStatus: "Paid",
      from: "2024-01-01",
      to: "2024-01-31",
      page: "2",
      limit: "20",
    });
    assert.equal(q.q, "INV-1");
    assert.equal(q.status, "group:pending");
    assert.equal(q.paymentStatus, "paid");
    assert.equal(q.from, "2024-01-01");
    assert.equal(q.to, "2024-01-31");
    assert.equal(q.page, 2);
    assert.equal(q.limit, 20);
    assert.equal(invoiceListHasFilters(q), true);
  });

  it("rejects invalid days and truncates search", () => {
    const q = parseInvoiceListQuery({
      q: "x".repeat(100),
      from: "not-a-day",
      paymentStatus: "",
    });
    assert.equal(q.q.length, 80);
    assert.equal(q.from, "");
    assert.equal(invoiceListHasFilters(q), true);
  });
});

describe("listInvoicesForShop", () => {
  it("returns null for missing store", async () => {
    const result = await listInvoicesForShop("missing.myshopify.com");
    assert.equal(result, null);
  });

  it("lists empty store", async () => {
    const { store } = await seedStore();
    const result = await listInvoicesForShop(store.shopifyDomain);
    assert.ok(result);
    assert.equal(result!.total, 0);
    assert.equal(result!.items.length, 0);
    assert.equal(result!.pages, 1);
  });

  it("searches by invoice number, order number, buyer name, and email (case-insensitive)", async () => {
    const { store } = await seedStore();
    await createInvoice(store, {
      invoiceNumber: "INV-SEARCH-01",
      shopifyOrderId: "1001",
      shopifyOrderNumber: "#1001",
      buyerName: "Grace Hopper",
      buyerEmail: "grace@Navy.mil",
    });
    await createInvoice(store, {
      invoiceNumber: "INV-OTHER",
      shopifyOrderId: "1002",
      buyerName: "Other",
      buyerEmail: "other@example.com",
    });

    const byInv = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      q: "inv-search",
    });
    assert.equal(byInv!.total, 1);
    assert.equal(byInv!.items[0].invoiceNumber, "INV-SEARCH-01");

    const byOrder = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      q: "#1001",
    });
    assert.equal(byOrder!.total, 1);

    const byName = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      q: "grace hopper",
    });
    assert.equal(byName!.total, 1);

    const byEmail = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      q: "GRACE@navy.mil",
    });
    assert.equal(byEmail!.total, 1);
  });

  it("filters by document status group and payment status", async () => {
    const { store } = await seedStore();
    await createInvoice(store, {
      invoiceNumber: "INV-A",
      shopifyOrderId: "a",
      status: "generated",
      financialStatus: "pending",
    });
    await createInvoice(store, {
      invoiceNumber: "INV-B",
      shopifyOrderId: "b",
      status: "downloaded",
      financialStatus: "paid",
    });
    await createInvoice(store, {
      invoiceNumber: "INV-C",
      shopifyOrderId: "c",
      status: "failed",
      financialStatus: "paid",
    });

    const pending = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      status: "group:pending",
    });
    assert.equal(pending!.total, 1);
    assert.equal(pending!.items[0].invoiceNumber, "INV-A");

    const paid = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      paymentStatus: "paid",
    });
    assert.equal(paid!.total, 2);

    const exact = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      status: "failed",
      paymentStatus: "paid",
    });
    assert.equal(exact!.total, 1);
    assert.equal(exact!.items[0].invoiceNumber, "INV-C");
  });

  it("filters by inclusive Dubai date range on issueDate", async () => {
    const { store } = await seedStore();
    await createInvoice(store, {
      invoiceNumber: "INV-D1",
      shopifyOrderId: "d1",
      issueDate: new Date("2024-01-01T12:00:00+04:00"),
    });
    await createInvoice(store, {
      invoiceNumber: "INV-D2",
      shopifyOrderId: "d2",
      issueDate: new Date("2024-02-15T12:00:00+04:00"),
    });

    const jan = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      from: "2024-01-01",
      to: "2024-01-31",
    });
    assert.equal(jan!.total, 1);
    assert.equal(jan!.items[0].invoiceNumber, "INV-D1");
  });

  it("paginates with stable ordering and clamps overflow pages", async () => {
    const { store } = await seedStore();
    for (let i = 1; i <= 5; i++) {
      await createInvoice(store, {
        invoiceNumber: `INV-P${i}`,
        shopifyOrderId: `p${i}`,
        issueDate: new Date(`2024-03-0${i}T10:00:00Z`),
      });
    }
    const page1 = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      page: 1,
      limit: 2,
    });
    assert.equal(page1!.items.length, 2);
    assert.equal(page1!.total, 5);
    assert.equal(page1!.pages, 3);
    assert.equal(page1!.items[0].invoiceNumber, "INV-P5");

    const overflow = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      page: 99,
      limit: 2,
    });
    assert.equal(overflow!.page, 3);
    assert.equal(overflow!.items.length, 1);
  });

  it("scopes results to the shop store only", async () => {
    const a = await seedStore();
    const b = await seedStore();
    await createInvoice(a.store, {
      invoiceNumber: "INV-A-ONLY",
      shopifyOrderId: "a1",
    });
    await createInvoice(b.store, {
      invoiceNumber: "INV-B-ONLY",
      shopifyOrderId: "b1",
    });
    const result = await listInvoicesForShop(a.store.shopifyDomain);
    assert.equal(result!.total, 1);
    assert.equal(result!.items[0].invoiceNumber, "INV-A-ONLY");
  });
});

describe("CSV export", () => {
  it("exports all invoices ignoring list filters and escapes cells", async () => {
    const { store } = await seedStore();
    await createInvoice(store, {
      invoiceNumber: 'INV,"QUOTE"',
      shopifyOrderId: "csv1",
      buyerName: "Line\nBreak",
      financialStatus: "paid",
    });
    await createInvoice(store, {
      invoiceNumber: "INV-CSV-2",
      shopifyOrderId: "csv2",
      financialStatus: "pending",
      issueDate: new Date("2023-01-01T00:00:00Z"),
    });

    const exported = await exportAllInvoicesForShop(store.shopifyDomain);
    assert.ok(exported);
    assert.equal(exported!.items.length, 2);
    assert.equal(exported!.truncated, false);

    const csv = invoicesToCsv(exported!.items);
    assert.match(csv, /Invoice,Order,Customer/);
    assert.match(csv, /INV,""QUOTE""|INV,\"\"QUOTE\"\"/);
    assert.match(csv, /Paid/);
    assert.equal(CSV_EXPORT_LIMIT, 5000);
  });

  it("does not use UI filter state (exports unpaid even if list filtered to paid)", async () => {
    const { store } = await seedStore();
    await createInvoice(store, {
      invoiceNumber: "INV-PAID",
      shopifyOrderId: "fp1",
      financialStatus: "paid",
    });
    await createInvoice(store, {
      invoiceNumber: "INV-PEND",
      shopifyOrderId: "fp2",
      financialStatus: "pending",
    });

    const filtered = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      paymentStatus: "paid",
    });
    assert.equal(filtered!.total, 1);

    const exported = await exportAllInvoicesForShop(store.shopifyDomain);
    assert.equal(exported!.items.length, 2);
  });

  it("caps export at the agreed limit and sets truncated", async () => {
    assert.equal(CSV_EXPORT_LIMIT, 5000);
    const { store } = await seedStore();
    for (let i = 1; i <= 3; i++) {
      await createInvoice(store, {
        invoiceNumber: `INV-LIM-${i}`,
        shopifyOrderId: `lim${i}`,
        issueDate: new Date(`2024-04-0${i}T10:00:00Z`),
      });
    }
    // Use a small take to prove truncation without inserting 5,000 rows.
    const exported = await exportAllInvoicesForShop(store.shopifyDomain, {
      limit: 2,
    });
    assert.ok(exported);
    assert.equal(exported!.items.length, 2);
    assert.equal(exported!.truncated, true);
    assert.equal(exported!.limit, 2);
    // Production path never exceeds the constant.
    assert.ok(exported!.limit <= CSV_EXPORT_LIMIT);
  });
});

describe("enqueueSyncOrders (Group 8 reuse)", () => {
  it("returns background mode without awaiting sync", async () => {
    const { store } = await seedStore();
    const mode = await enqueueSyncOrders(store.shopifyDomain);
    assert.equal(mode, "background");
  });
});
