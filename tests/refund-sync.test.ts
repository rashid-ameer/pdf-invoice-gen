import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  createCreditNoteFromRefund,
  handleRefundCreated,
  type ShopifyRefund,
} from "../app/models/credit-note.server";
import {
  mapGraphqlRefunds,
  orderGid,
  type GraphqlOrder,
} from "../app/models/shopify-admin-graphql.server";
import {
  SYNC_REFUNDS_DEFAULT_LIMIT,
  syncRefundsForShop,
} from "../app/models/refund-sync.server";
import { enqueueSyncRefunds } from "../app/models/sync-queue.server";
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
  shopifyOrderId?: string,
) {
  const orderId = shopifyOrderId ?? String(Math.floor(Math.random() * 1e9));
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
      currency: "AED",
      seller: {
        legalName: "Acme Trading LLC",
        address: { line1: "Street 1", city: "Dubai", country: "AE" },
      },
      buyer: { name: "Ada Lovelace", email: "buyer@example.com" },
      lineItems: JSON.parse(JSON.stringify([invoiceLine()])),
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

describe("mapGraphqlRefunds adapter", () => {
  it("maps refund id, order id, dates, note, lines, tax, txs, adjustments", () => {
    const order: GraphqlOrder = {
      id: "gid://shopify/Order/555",
      legacyResourceId: "555",
      refunds: [
        {
          id: "gid://shopify/Refund/999",
          createdAt: "2024-09-01T08:00:00Z",
          note: "Partial return",
          refundLineItems: {
            nodes: [
              {
                quantity: 2,
                restockType: "RETURN",
                subtotalSet: { shopMoney: { amount: "50.00" } },
                totalTaxSet: { shopMoney: { amount: "2.50" } },
                lineItem: {
                  id: "gid://shopify/LineItem/77",
                  title: "Mug",
                  name: "Mug - White",
                  sku: "MUG-1",
                  quantity: 3,
                  variantTitle: "White",
                  originalUnitPriceSet: { shopMoney: { amount: "25.00" } },
                  taxLines: [
                    {
                      rate: 0.05,
                      priceSet: { shopMoney: { amount: "1.25" } },
                    },
                  ],
                },
              },
            ],
          },
          transactions: {
            nodes: [
              {
                amountSet: {
                  shopMoney: { amount: "52.50", currencyCode: "AED" },
                },
                status: "SUCCESS",
              },
            ],
          },
          orderAdjustments: {
            nodes: [
              {
                amountSet: { shopMoney: { amount: "-1.00" } },
                taxAmountSet: { shopMoney: { amount: "-0.05" } },
                reason: "Shipping refund",
              },
            ],
          },
        },
      ],
    };

    const refunds = mapGraphqlRefunds(order);
    assert.equal(refunds.length, 1);
    const refund = refunds[0];
    assert.equal(refund.id, 999);
    assert.equal(refund.order_id, 555);
    assert.equal(refund.created_at, "2024-09-01T08:00:00Z");
    assert.equal(refund.note, "Partial return");
    assert.equal(refund.restock, true);
    assert.equal(refund.refund_line_items?.length, 1);
    assert.equal(refund.refund_line_items![0].quantity, 2);
    assert.equal(refund.refund_line_items![0].subtotal, "50.00");
    assert.equal(refund.refund_line_items![0].total_tax, "2.50");
    assert.equal(refund.refund_line_items![0].line_item?.sku, "MUG-1");
    assert.equal(refund.refund_line_items![0].line_item?.price, "25.00");
    assert.equal(refund.refund_line_items![0].line_item?.tax_lines?.[0].rate, 0.05);
    assert.equal(refund.transactions?.[0].amount, "52.50");
    assert.equal(refund.transactions?.[0].currency, "AED");
    assert.equal(refund.transactions?.[0].status, "success");
    assert.equal(refund.order_adjustments?.[0].tax_amount, "-0.05");
    assert.equal(refund.order_adjustments?.[0].reason, "Shipping refund");
  });

  it("builds order GID from numeric id", () => {
    assert.equal(orderGid(123), "gid://shopify/Order/123");
    assert.equal(orderGid("gid://shopify/Order/9"), "gid://shopify/Order/9");
  });
});

describe("handleRefundCreated webhook path", () => {
  it("creates a credit note with webhook→shopify source", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId);

    const note = await handleRefundCreated(
      store.shopifyDomain,
      refund,
      "refunds/create",
    );
    assert.ok(note);
    assert.equal(note!.shopifyRefundId, String(refund.id));

    const event = await prisma.invoiceStatusEvent.findFirst({
      where: { creditNoteId: note!.id },
    });
    assert.equal(event?.source, "shopify");
  });

  it("returns null when invoice is missing", async () => {
    const { store } = await seedStore();
    const note = await handleRefundCreated(
      store.shopifyDomain,
      baseRefund(888001),
    );
    assert.equal(note, null);
    assert.equal(
      await prisma.creditNote.count({ where: { storeId: store.id } }),
      0,
    );
  });

  it("is idempotent on duplicate webhook delivery", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId);

    const a = await handleRefundCreated(store.shopifyDomain, refund);
    const b = await handleRefundCreated(store.shopifyDomain, refund);
    assert.equal(a!.id, b!.id);
    assert.equal(
      await prisma.creditNote.count({ where: { storeId: store.id } }),
      1,
    );
  });

  it("webhook + sync race leaves a single credit note", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const refund = baseRefund(invoice.shopifyOrderId);

    const [a, b] = await Promise.all([
      handleRefundCreated(store.shopifyDomain, refund),
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
});

describe("syncRefundsForShop", () => {
  it("uses default limit 40", () => {
    assert.equal(SYNC_REFUNDS_DEFAULT_LIMIT, 40);
  });

  it("creates missing notes, skips existing, continues after failure", async () => {
    const { merchant, store } = await seedStore();
    await seedInvoice(store.id, merchant.id, "1001");
    await seedInvoice(store.id, merchant.id, "1002");
    await seedInvoice(store.id, merchant.id, "1003");

    // Pre-existing CN for inv1 refund 11
    await createCreditNoteFromRefund(
      store.shopifyDomain,
      baseRefund(1001, { id: 11 }),
      "sync",
    );

    // One new create + one skip + one throw — only one successful create so
    // parallel invoice workers do not race on count-based creditNoteNumber
    // (same race profile as the old app under concurrency).
    const result = await syncRefundsForShop(store.shopifyDomain, 40, {
      getOfflineAccessTokenForShop: async () => "tok",
      fetchOrderRefunds: async (_shop, orderId) => {
        if (orderId === "1001") {
          return [baseRefund(1001, { id: 11 })];
        }
        if (orderId === "1002") {
          return [
            {
              id: 21,
              order_id: 1002,
              refund_line_items: [],
              transactions: [{ amount: "0" }],
            },
          ];
        }
        if (orderId === "1003") {
          return [baseRefund(1003, { id: 31 })];
        }
        return [];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.fetched, 3);
    assert.equal(result.created, 1); // 31
    assert.equal(result.skipped, 1); // 11 existing
    assert.equal(result.failed, 1); // zero-value on 1002
    assert.ok(result.errors.length >= 1);

    const notes = await prisma.creditNote.findMany({
      where: { storeId: store.id },
      orderBy: { shopifyRefundId: "asc" },
    });
    assert.deepEqual(
      notes.map((n) => n.shopifyRefundId).sort(),
      ["11", "31"],
    );

    const createdViaSync = await prisma.invoiceStatusEvent.findFirst({
      where: {
        creditNoteId: notes.find((n) => n.shopifyRefundId === "31")!.id,
      },
    });
    assert.equal(createdViaSync?.source, "merchant");

    // Second pass creates another missing refund on the same invoice set
    const second = await syncRefundsForShop(store.shopifyDomain, 40, {
      getOfflineAccessTokenForShop: async () => "tok",
      fetchOrderRefunds: async (_shop, orderId) => {
        if (orderId === "1001") {
          return [baseRefund(1001, { id: 12 })];
        }
        return [];
      },
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.created, 1);
      assert.equal(second.skipped, 0);
    }
  });

  it("returns needsReauth when offline session is missing", async () => {
    const { store } = await seedStore();
    const result = await syncRefundsForShop(store.shopifyDomain, 40, {
      getOfflineAccessTokenForShop: async () => null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.needsReauth, true);
    }
  });

  it("skips when create returns null (no invoice for that refund order)", async () => {
    const { merchant, store } = await seedStore();
    // Invoice exists for order 2001, but refund claims order 9999
    await seedInvoice(store.id, merchant.id, "2001");

    const result = await syncRefundsForShop(store.shopifyDomain, 40, {
      getOfflineAccessTokenForShop: async () => "tok",
      fetchOrderRefunds: async () => [baseRefund(9999, { id: 44 })],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
  });
});

describe("enqueueSyncRefunds", () => {
  it("returns background and does not use Redis/BullMQ", async () => {
    const mode = await enqueueSyncRefunds("unused.myshopify.com");
    assert.equal(mode, "background");

    const queueSource = readFileSync(
      join(process.cwd(), "app/models/sync-queue.server.ts"),
      "utf8",
    );
    assert.match(queueSource, /runSyncRefundsJob/);
    assert.match(queueSource, /waitUntil/);
    // No runtime queue imports (comments may mention Redis/BullMQ as future notes).
    assert.doesNotMatch(
      queueSource,
      /from ["']bullmq["']|from ["']ioredis["']|from ["'].*queue\.js["']/,
    );
  });
});

describe("Phase 2 route and toml configuration", () => {
  it("registers refunds/create webhook route and toml topic", () => {
    const route = readFileSync(
      join(process.cwd(), "app/routes/webhooks.refunds.create.tsx"),
      "utf8",
    );
    assert.match(route, /authenticate\.webhook/);
    assert.match(route, /handleRefundCreated/);

    const toml = readFileSync(join(process.cwd(), "shopify.app.toml"), "utf8");
    assert.match(toml, /refunds\/create/);
    assert.match(toml, /\/webhooks\/refunds\/create/);
  });
});
