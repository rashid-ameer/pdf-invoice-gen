/**
 * Group 15 Phase B — order-document APIs (ensure, summary, preview, print, email, link).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  buildOrderInvoicePreviewHtml,
  buildOrderPrintHtml,
  emailOrderInvoice,
  ensureInvoiceForShopifyOrder,
  getOrderDocumentsSummary,
  issueOrderInvoicePublicLink,
  normalizePrintTypes,
  normalizeShopifyOrderId,
  type OrderDocumentsDeps,
} from "../app/models/order-documents.server";
import {
  handleExtensionResource,
  jsonResponse,
} from "../app/models/extension-resource.server";
import { encryptSecret } from "../app/utils/token-crypto";
import type { ShopifyOrder } from "../app/models/invoice-create.server";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore(domain?: string) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: domain ?? `od-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

async function seedInvoice(
  storeId: string,
  merchantId: string,
  shopifyOrderId: string,
  opts?: { buyerEmail?: string },
) {
  return prisma.invoice.create({
    data: {
      merchantId,
      storeId,
      legalEntityId: merchantId,
      shopifyOrderId,
      shopifyOrderNumber: `#${shopifyOrderId}`,
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      status: "generated",
      issueDate: new Date("2024-06-01T00:00:00.000Z"),
      currency: "AED",
      seller: { name: "Seller" },
      buyer: {
        name: "Buyer",
        email: opts?.buyerEmail ?? "buyer@example.com",
      },
      lineItems: [],
      totals: { grandTotal: 100 },
    },
  });
}

async function seedCreditNote(
  storeId: string,
  merchantId: string,
  invoiceId: string,
  shopifyOrderId: string,
  number: string,
) {
  return prisma.creditNote.create({
    data: {
      merchantId,
      storeId,
      invoiceId,
      shopifyRefundId: `refund-${randomUUID()}`,
      shopifyOrderId,
      creditNoteNumber: number,
      status: "generated",
      issueDate: new Date("2024-06-02T00:00:00.000Z"),
      currency: "AED",
      seller: { name: "Seller" },
      buyer: { name: "Buyer", email: "buyer@example.com" },
      lineItems: [],
      totals: { grandTotal: 10 },
    },
  });
}

function sampleOrder(id: string): ShopifyOrder {
  return {
    id: Number(id),
    order_number: Number(id),
    name: `#${id}`,
    email: "buyer@example.com",
    currency: "AED",
    financial_status: "paid",
    total_price: "100.00",
    subtotal_price: "100.00",
    total_tax: "0",
    total_discounts: "0",
    created_at: "2024-06-01T00:00:00Z",
    line_items: [
      {
        title: "Item",
        quantity: 1,
        price: "100.00",
        total_discount: "0",
        tax_lines: [],
      },
    ],
  };
}

const authDeps = {
  decodeSessionToken: async () => ({
    dest: "https://auth-shop.myshopify.com",
  }),
  sanitizeShop: (shop: string) =>
    shop.endsWith(".myshopify.com") ? shop : null,
  loadOfflineSession: async (shop: string) => ({
    id: `offline_${shop}`,
    shop,
    accessToken: "shpat",
    isOnline: false,
  }),
  getConfiguredCorsOrigins: () => [] as string[],
};

describe("normalizeShopifyOrderId / print types", () => {
  it("normalizes GID and numeric ids", () => {
    assert.equal(
      normalizeShopifyOrderId("gid://shopify/Order/5678"),
      "5678",
    );
    assert.equal(normalizeShopifyOrderId("5678"), "5678");
    assert.equal(normalizeShopifyOrderId("abc"), null);
  });

  it("preserves requested type order and rejects empty", () => {
    assert.deepEqual(normalizePrintTypes(""), []);
    assert.deepEqual(normalizePrintTypes(null), []);
    assert.deepEqual(
      normalizePrintTypes("packing_slip,invoice,credit_note"),
      ["packing_slip", "invoice", "credit_note"],
    );
  });
});

describe("ensureInvoiceForShopifyOrder", () => {
  it("returns existing invoice without creating", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "1001");
    let createdCalls = 0;
    const result = await ensureInvoiceForShopifyOrder(
      store.shopifyDomain,
      "gid://shopify/Order/1001",
      {
        fetchOrderById: async () => {
          throw new Error("should not fetch");
        },
        createInvoiceFromShopifyOrder: async () => {
          createdCalls += 1;
          return null;
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.invoice.id, invoice.id);
      assert.equal(result.created, false);
    }
    assert.equal(createdCalls, 0);
  });

  it("creates invoice when missing via Group 8 path", async () => {
    const { store, merchant } = await seedStore();
    const orderId = String(2000 + Math.floor(Math.random() * 100000));
    let fetchCalls = 0;
    const created = await seedInvoice(store.id, merchant.id, orderId);
    // delete so ensure must create — but we'll inject create returning a new row
    await prisma.invoice.delete({ where: { id: created.id } });

    const result = await ensureInvoiceForShopifyOrder(
      store.shopifyDomain,
      orderId,
      {
        fetchOrderById: async () => {
          fetchCalls += 1;
          return { order: sampleOrder(orderId), refunds: [] };
        },
        createInvoiceFromShopifyOrder: async (shop, order) => {
          assert.equal(shop, store.shopifyDomain);
          assert.equal(String(order.id), orderId);
          return seedInvoice(store.id, merchant.id, orderId);
        },
      },
    );
    assert.equal(fetchCalls, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.created, true);
      assert.equal(result.invoice.shopifyOrderId, orderId);
    }
  });

  it("returns error when Shopify order is missing", async () => {
    const { store } = await seedStore();
    const result = await ensureInvoiceForShopifyOrder(
      store.shopifyDomain,
      "999999",
      {
        fetchOrderById: async () => null,
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Order not found/i);
    }
  });

  it("create race resolves to existing invoice without duplicate", async () => {
    const { store, merchant } = await seedStore();
    const orderId = String(3000 + Math.floor(Math.random() * 100000));
    const existing = await seedInvoice(store.id, merchant.id, orderId);

    const result = await ensureInvoiceForShopifyOrder(
      store.shopifyDomain,
      orderId,
      {
        fetchOrderById: async () => ({
          order: sampleOrder(orderId),
          refunds: [],
        }),
        // Simulate create returning null (lost race) — ensure re-reads DB
        createInvoiceFromShopifyOrder: async () => null,
      },
    );
    // Existing was already there before fetch path... wait, ensure finds existing first.
    // For race test: start without invoice, create throws after concurrent insert.
    await prisma.invoice.delete({ where: { id: existing.id } });

    const raced = await ensureInvoiceForShopifyOrder(
      store.shopifyDomain,
      orderId,
      {
        fetchOrderById: async () => ({
          order: sampleOrder(orderId),
          refunds: [],
        }),
        createInvoiceFromShopifyOrder: async () => {
          // Concurrent request already created:
          await seedInvoice(store.id, merchant.id, orderId);
          return null;
        },
      },
    );
    assert.equal(raced.ok, true);
    if (raced.ok) {
      assert.equal(raced.invoice.shopifyOrderId, orderId);
      const count = await prisma.invoice.count({
        where: { storeId: store.id, shopifyOrderId: orderId },
      });
      assert.equal(count, 1);
    }
  });

  it("wrong shop cannot access another shop invoice", async () => {
    const a = await seedStore(`shop-a-${randomUUID()}.myshopify.com`);
    const b = await seedStore(`shop-b-${randomUUID()}.myshopify.com`);
    await seedInvoice(a.store.id, a.merchant.id, "7777");

    const result = await ensureInvoiceForShopifyOrder(
      b.store.shopifyDomain,
      "7777",
      {
        fetchOrderById: async () => null,
      },
    );
    assert.equal(result.ok, false);
    const underB = await prisma.invoice.findFirst({
      where: { storeId: b.store.id, shopifyOrderId: "7777" },
    });
    assert.equal(underB, null);
  });
});

describe("documents / preview / print", () => {
  it("returns invoice summary and credit-note count", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "4001");
    await seedCreditNote(store.id, merchant.id, invoice.id, "4001", "CN-1");
    await seedCreditNote(store.id, merchant.id, invoice.id, "4001", "CN-2");

    const summary = await getOrderDocumentsSummary(
      store.shopifyDomain,
      "gid://shopify/Order/4001",
    );
    assert.equal(summary.ok, true);
    if (summary.ok) {
      assert.equal(summary.invoice.id, invoice.id);
      assert.equal(summary.creditNotesCount, 2);
      assert.equal(summary.creditNotes.length, 2);
    }
  });

  it("preview returns HTML and does not record download", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "4002");
    let renderCalls = 0;

    const preview = await buildOrderInvoicePreviewHtml(
      store.shopifyDomain,
      "4002",
      {
        renderInvoiceDocument: async () => {
          renderCalls += 1;
          return {
            html: "<html><body>INV</body></html>",
            invoiceNumber: invoice.invoiceNumber,
            orderNumber: "#4002",
            templateId: "t",
            templateCode: "modern",
            templateName: "Modern",
            documentType: "tax_invoice",
          };
        },
      },
    );
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.match(preview.html, /INV/);
    }
    assert.equal(renderCalls, 1);

    const events = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    assert.equal(events, 0);
  });

  it("print invoice / packing / CN / refund / multi / order / empty / no download", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "4003");
    await seedCreditNote(store.id, merchant.id, invoice.id, "4003", "CN-A");
    await seedCreditNote(store.id, merchant.id, invoice.id, "4003", "CN-B");

    const pages: string[] = [];
    const deps: OrderDocumentsDeps = {
      renderInvoiceDocument: async () => {
        pages.push("invoice");
        return {
          html: "<html><body>invoice</body></html>",
          invoiceNumber: invoice.invoiceNumber,
          orderNumber: "#4003",
          templateId: "t",
          templateCode: "modern",
          templateName: "Modern",
          documentType: "tax_invoice",
        };
      },
      renderPackingSlipDocument: async () => {
        pages.push("packing_slip");
        return {
          html: "<html><body>packing</body></html>",
          invoiceNumber: invoice.invoiceNumber,
          orderNumber: "#4003",
          templateId: "t",
          templateCode: "packing-slip",
          templateName: "Packing",
          documentType: "packing_slip",
        };
      },
      renderCreditNoteDocument: async (_shop, id) => {
        pages.push(`credit_note:${id}`);
        return {
          html: `<html><body>cn-${id}</body></html>`,
          creditNoteNumber: "CN",
          orderNumber: "#4003",
          originalInvoiceNumber: invoice.invoiceNumber,
          templateId: "t",
          templateCode: "credit-note",
          templateName: "CN",
          documentType: "credit_note" as const,
        };
      },
      renderRefundDocument: async (_shop, id) => {
        pages.push(`refund_document:${id}`);
        return {
          html: `<html><body>rd-${id}</body></html>`,
          creditNoteNumber: "CN",
          orderNumber: "#4003",
          originalInvoiceNumber: invoice.invoiceNumber,
          templateId: "t",
          templateCode: "refund-document",
          templateName: "RD",
          documentType: "refund_document" as const,
        };
      },
    };

    const empty = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "",
      deps,
    );
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.status, 400);

    pages.length = 0;
    const invOnly = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "invoice",
      deps,
    );
    assert.equal(invOnly.ok, true);
    assert.deepEqual(pages, ["invoice"]);

    pages.length = 0;
    const packing = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "packing_slip",
      deps,
    );
    assert.equal(packing.ok, true);
    assert.deepEqual(pages, ["packing_slip"]);

    pages.length = 0;
    const cn = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "credit_note",
      deps,
    );
    assert.equal(cn.ok, true);
    assert.equal(pages.length, 2);
    assert.ok(pages.every((p) => p.startsWith("credit_note:")));

    pages.length = 0;
    const rd = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "refund_document",
      deps,
    );
    assert.equal(rd.ok, true);
    assert.equal(pages.length, 2);
    assert.ok(pages.every((p) => p.startsWith("refund_document:")));

    pages.length = 0;
    const multi = await buildOrderPrintHtml(
      store.shopifyDomain,
      "4003",
      "packing_slip,invoice,credit_note",
      deps,
    );
    assert.equal(multi.ok, true);
    if (multi.ok) {
      assert.deepEqual(multi.types, [
        "packing_slip",
        "invoice",
        "credit_note",
      ]);
      assert.match(multi.html, /packing/);
      assert.match(multi.html, /invoice/);
      assert.ok(pages[0] === "packing_slip");
      assert.ok(pages[1] === "invoice");
    }

    const events = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    assert.equal(events, 0);

    const missing = await buildOrderPrintHtml(
      `missing-${randomUUID()}.myshopify.com`,
      "4003",
      "invoice",
      deps,
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);
  });
});

describe("email and customer link", () => {
  it("calls Group 12 sendInvoiceEmail with trigger manual", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "5001");
    let called: { shop: string; invoiceId: string; trigger: string } | null =
      null;

    const result = await emailOrderInvoice(store.shopifyDomain, "5001", {
      sendInvoiceEmail: async (opts) => {
        called = {
          shop: opts.shop,
          invoiceId: opts.invoiceId,
          trigger: opts.trigger,
        };
        return { ok: true, to: "buyer@example.com", providerId: "msg_1" };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(called, {
      shop: store.shopifyDomain,
      invoiceId: invoice.id,
      trigger: "manual",
    });
    if (result.ok) assert.equal(result.messageId, "msg_1");
  });

  it("email failure surfaces as unsuccessful result", async () => {
    const { store, merchant } = await seedStore();
    await seedInvoice(store.id, merchant.id, "5002");
    const result = await emailOrderInvoice(store.shopifyDomain, "5002", {
      sendInvoiceEmail: async () => ({ ok: false, error: "Resend down" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Resend/);
  });

  it("customer link calls Group 13 ForShop issuer", async () => {
    const { store, merchant } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id, "5003");
    let calledShop = "";
    let calledInvoice = "";

    const result = await issueOrderInvoicePublicLink(
      store.shopifyDomain,
      "5003",
      {
        issueInvoicePublicLinkForShop: async (shop, invoiceId) => {
          calledShop = shop;
          calledInvoice = invoiceId;
          return {
            ok: true as const,
            url: "https://example.com/public/invoices/tok",
            expiresAt: new Date("2024-07-01T00:00:00.000Z"),
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(calledShop, store.shopifyDomain);
    assert.equal(calledInvoice, invoice.id);
    if (result.ok) {
      assert.equal(result.url, "https://example.com/public/invoices/tok");
    }
  });

  it("customer-link failure", async () => {
    const { store, merchant } = await seedStore();
    await seedInvoice(store.id, merchant.id, "5004");
    const result = await issueOrderInvoicePublicLink(
      store.shopifyDomain,
      "5004",
      {
        issueInvoicePublicLinkForShop: async () => null,
      },
    );
    assert.equal(result.ok, false);
  });

  it("customer-link store isolation via shop argument", async () => {
    const a = await seedStore(`link-a-${randomUUID()}.myshopify.com`);
    const b = await seedStore(`link-b-${randomUUID()}.myshopify.com`);
    await seedInvoice(a.store.id, a.merchant.id, "5005");

    const result = await issueOrderInvoicePublicLink(
      b.store.shopifyDomain,
      "5005",
      {
        fetchOrderById: async () => null,
        issueInvoicePublicLinkForShop: async () => {
          throw new Error("should not issue");
        },
      },
    );
    assert.equal(result.ok, false);
  });
});

describe("extension auth integration on resource helper", () => {
  it("Bearer and query token authenticate; invalid → 401; OPTIONS → 204", async () => {
    const opts = {
      ...authDeps,
      decodeSessionToken: async () => ({
        dest: "https://auth-shop.myshopify.com",
      }),
    };

    const bearer = await handleExtensionResource(
      new Request("https://app.example/app/api/orders/1/documents", {
        headers: {
          Authorization: "Bearer a.b.c",
          Origin: "https://admin.shopify.com",
        },
      }),
      async (ctx) => {
        assert.equal(ctx.shop, "auth-shop.myshopify.com");
        return jsonResponse({ ok: true }, 200);
      },
      opts,
    );
    assert.equal(bearer.status, 200);
    assert.equal(
      bearer.headers.get("Access-Control-Allow-Origin"),
      "https://admin.shopify.com",
    );

    const query = await handleExtensionResource(
      new Request("https://app.example/app/print?token=a.b.c&orderId=1", {
        headers: { Origin: "https://store.myshopify.com" },
      }),
      async () => jsonResponse({ ok: true }, 200),
      opts,
    );
    assert.equal(query.status, 200);

    const invalid = await handleExtensionResource(
      new Request("https://app.example/app/print", {
        headers: { Origin: "https://admin.shopify.com" },
      }),
      async () => jsonResponse({ ok: true }, 200),
      opts,
    );
    assert.equal(invalid.status, 401);

    const options = await handleExtensionResource(
      new Request("https://app.example/app/print", {
        method: "OPTIONS",
        headers: { Origin: "https://admin.shopify.com" },
      }),
      async () => {
        throw new Error("handler must not run");
      },
      opts,
    );
    assert.equal(options.status, 204);
  });
});
