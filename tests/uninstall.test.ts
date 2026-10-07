/**
 * Group 17 Phase 1 — uninstall session parity with old handleAppUninstall.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  deleteSessionsByShop,
  handleAppUninstall,
} from "../app/models/install.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{
  merchantId: string;
  storeId: string;
  shops: string[];
}> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.session.deleteMany({ where: { shop: { in: row.shops } } });
    if (row.storeId !== "__none__") {
      await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
      await prisma.invoiceStatusEvent.deleteMany({
        where: { invoice: { storeId: row.storeId } },
      });
      await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
      await prisma.invoiceTemplate.deleteMany({
        where: { storeId: row.storeId },
      });
      await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
      await prisma.store.deleteMany({ where: { id: row.storeId } });
    }
    await prisma.shopBranding.deleteMany({
      where: { shop: { in: row.shops } },
    });
    if (row.merchantId !== "__none__") {
      await prisma.legalEntity.deleteMany({
        where: { merchantId: row.merchantId },
      });
      await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
    }
  }
  await prisma.$disconnect();
});

async function seedShop(opts?: { withDocs?: boolean }) {
  const shop = `uninstall-${randomUUID()}.myshopify.com`;
  const otherShop = `other-${randomUUID()}.myshopify.com`;
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: shop,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({
    merchantId: merchant.id,
    storeId: store.id,
    shops: [shop, otherShop],
  });

  const legalEntity = await prisma.legalEntity.create({
    data: {
      merchantId: merchant.id,
      legalName: "Acme Trading LLC",
      businessEmail: "billing@acme.test",
      address: { line1: "Street 1", city: "Dubai", country: "AE" },
    },
  });

  await prisma.shopBranding.create({
    data: {
      shop,
      primaryColor: "#111111",
      secondaryColor: "#222222",
      accentColor: "#333333",
    },
  });

  let invoiceId: string | undefined;
  let creditNoteId: string | undefined;
  let templateId: string | undefined;

  if (opts?.withDocs) {
    const seller = { name: "Acme Trading LLC", email: "billing@acme.test" };
    const buyer = { name: "Buyer", email: "buyer@test.com" };
    const invoice = await prisma.invoice.create({
      data: {
        storeId: store.id,
        merchantId: merchant.id,
        legalEntityId: legalEntity.id,
        shopifyOrderId: `order-${randomUUID()}`,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        status: "issued",
        currency: "AED",
        issueDate: new Date(),
        seller,
        buyer,
        lineItems: [],
        totals: { grandTotal: 100 },
      },
    });
    invoiceId = invoice.id;

    const note = await prisma.creditNote.create({
      data: {
        storeId: store.id,
        merchantId: merchant.id,
        invoiceId: invoice.id,
        shopifyOrderId: invoice.shopifyOrderId,
        shopifyRefundId: `refund-${randomUUID()}`,
        creditNoteNumber: `CN-${randomUUID().slice(0, 8)}`,
        status: "issued",
        currency: "AED",
        issueDate: new Date(),
        seller,
        buyer,
        lineItems: [],
        totals: { grandTotal: 10 },
      },
    });
    creditNoteId = note.id;

    const template = await prisma.invoiceTemplate.create({
      data: {
        storeId: store.id,
        merchantId: merchant.id,
        code: `custom-${randomUUID().slice(0, 8)}`,
        name: "Custom uninstall keep",
        documentType: "tax_invoice",
        baseLayoutCode: "modern",
        isSystem: false,
        isActive: true,
        config: {},
      },
    });
    templateId = template.id;
  }

  return {
    shop,
    otherShop,
    merchant,
    store,
    legalEntity,
    invoiceId,
    creditNoteId,
    templateId,
  };
}

async function createSession(shop: string, suffix: string) {
  return prisma.session.create({
    data: {
      id: `offline_${shop}_${suffix}`,
      shop,
      state: "state",
      isOnline: false,
      accessToken: "token",
      scope: "read_orders",
    },
  });
}

describe("Group 17 Phase 1 — handleAppUninstall", () => {
  it("marks store uninstalled and deletes all sessions for the shop", async () => {
    const { shop, store } = await seedShop();
    await createSession(shop, "a");
    await createSession(shop, "b");

    await handleAppUninstall(shop);

    const updated = await prisma.store.findUnique({ where: { id: store.id } });
    assert.equal(updated?.status, "uninstalled");
    assert.equal(await prisma.session.count({ where: { shop } }), 0);
  });

  it("removes multiple sessions for the same shop", async () => {
    const { shop } = await seedShop();
    await createSession(shop, "1");
    await createSession(shop, "2");
    await createSession(shop, "3");

    await handleAppUninstall(shop);

    assert.equal(await prisma.session.count({ where: { shop } }), 0);
  });

  it("clears sessions even when called without a webhook session object", async () => {
    // Same public API the webhook uses — no session argument.
    const { shop, store } = await seedShop();
    await createSession(shop, "solo");

    await handleAppUninstall(shop);

    assert.equal(
      (await prisma.store.findUnique({ where: { id: store.id } }))?.status,
      "uninstalled",
    );
    assert.equal(await prisma.session.count({ where: { shop } }), 0);
  });

  it("is safe when the store does not exist", async () => {
    const ghost = `missing-${randomUUID()}.myshopify.com`;
    await createSession(ghost, "x");
    // Track for session cleanup only (no merchant/store rows).
    cleanup.push({
      merchantId: "__none__",
      storeId: "__none__",
      shops: [ghost],
    });

    await assert.doesNotReject(() => handleAppUninstall(ghost));
    assert.equal(await prisma.session.count({ where: { shop: ghost } }), 0);
  });

  it("does not delete sessions belonging to another shop", async () => {
    const { shop, otherShop } = await seedShop();
    await createSession(shop, "mine");
    await createSession(otherShop, "theirs");

    await handleAppUninstall(shop);

    assert.equal(await prisma.session.count({ where: { shop } }), 0);
    assert.equal(await prisma.session.count({ where: { shop: otherShop } }), 1);
  });

  it("preserves invoices, credit notes, templates, branding, and legal entity", async () => {
    const seeded = await seedShop({ withDocs: true });
    await createSession(seeded.shop, "keep-docs");

    await handleAppUninstall(seeded.shop);

    assert.ok(
      await prisma.invoice.findUnique({ where: { id: seeded.invoiceId! } }),
    );
    assert.ok(
      await prisma.creditNote.findUnique({
        where: { id: seeded.creditNoteId! },
      }),
    );
    assert.ok(
      await prisma.invoiceTemplate.findUnique({
        where: { id: seeded.templateId! },
      }),
    );
    assert.ok(
      await prisma.shopBranding.findUnique({ where: { shop: seeded.shop } }),
    );
    assert.ok(
      await prisma.legalEntity.findUnique({
        where: { id: seeded.legalEntity.id },
      }),
    );
    assert.equal(
      (await prisma.store.findUnique({ where: { id: seeded.store.id } }))
        ?.status,
      "uninstalled",
    );
  });

  it("webhook route always delegates session cleanup to handleAppUninstall", () => {
    const route = readFileSync(
      join(process.cwd(), "app/routes/webhooks.app.uninstalled.tsx"),
      "utf8",
    );
    assert.match(route, /handleAppUninstall/);
    assert.doesNotMatch(route, /session\.deleteMany|db\.session/);
    assert.match(
      readFileSync(join(process.cwd(), "app/models/install.server.ts"), "utf8"),
      /deleteSessionsByShop/,
    );
  });
});

describe("Group 17 Phase 1 — deleteSessionsByShop", () => {
  it("deletes only the requested shop", async () => {
    const a = `a-${randomUUID()}.myshopify.com`;
    const b = `b-${randomUUID()}.myshopify.com`;
    cleanup.push({
      merchantId: "__none__",
      storeId: "__none__",
      shops: [a, b],
    });
    await createSession(a, "1");
    await createSession(b, "1");

    await deleteSessionsByShop(a);

    assert.equal(await prisma.session.count({ where: { shop: a } }), 0);
    assert.equal(await prisma.session.count({ where: { shop: b } }), 1);
  });
});
