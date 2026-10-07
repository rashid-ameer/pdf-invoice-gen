/**
 * Group 17 Phase 2 — GDPR / privacy webhook handlers.
 */
import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import { encryptSecret } from "../app/utils/token-crypto";
import {
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
  redactedBuyer,
  setPrivacyDataRequestEmailForTests,
} from "../app/models/privacy.server";

const cleanup: Array<{
  merchantIds: string[];
  storeIds: string[];
  shops: string[];
}> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.session.deleteMany({ where: { shop: { in: row.shops } } });
    for (const storeId of row.storeIds) {
      await prisma.invoiceStatusEvent.deleteMany({
        where: { invoice: { storeId } },
      });
      await prisma.creditNote.deleteMany({ where: { storeId } });
      await prisma.invoice.deleteMany({ where: { storeId } });
      await prisma.invoiceTemplate.deleteMany({ where: { storeId } });
      await prisma.setting.deleteMany({ where: { storeId } });
    }
    await prisma.shopBranding.deleteMany({
      where: { shop: { in: row.shops } },
    });
    for (const merchantId of row.merchantIds) {
      const entities = await prisma.legalEntity.findMany({
        where: { merchantId },
        select: { id: true },
      });
      const entityIds = entities.map((e) => e.id);
      await prisma.taxIdentifier.deleteMany({
        where: { legalEntityId: { in: entityIds } },
      });
      await prisma.aspConnection.deleteMany({
        where: { legalEntityId: { in: entityIds } },
      });
      await prisma.legalEntity.deleteMany({ where: { merchantId } });
      await prisma.setting.deleteMany({ where: { merchantId } });
      await prisma.invoiceTemplate.deleteMany({ where: { merchantId } });
      await prisma.store.deleteMany({ where: { merchantId } });
      await prisma.merchant.deleteMany({ where: { id: merchantId } });
    }
  }
  await prisma.$disconnect();
});

afterEach(() => {
  setPrivacyDataRequestEmailForTests(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

async function seedMerchantShop(opts?: {
  shop?: string;
  withLegal?: boolean;
  merchantId?: string;
}) {
  const shop = opts?.shop ?? `privacy-${randomUUID()}.myshopify.com`;
  let merchantId = opts?.merchantId;
  if (!merchantId) {
    const merchant = await prisma.merchant.create({
      data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
    });
    merchantId = merchant.id;
  }
  const store = await prisma.store.create({
    data: {
      merchantId,
      shopifyDomain: shop,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });

  let legalEntityId: string | undefined;
  if (opts?.withLegal !== false) {
    const legal = await prisma.legalEntity.create({
      data: {
        merchantId,
        legalName: "Acme Trading LLC",
        businessEmail: "billing@acme.test",
        address: { line1: "Street 1", city: "Dubai", country: "AE" },
      },
    });
    legalEntityId = legal.id;
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultLegalEntityId: legal.id },
    });
  }

  const existing = cleanup.find((c) => c.merchantIds.includes(merchantId!));
  if (existing) {
    existing.storeIds.push(store.id);
    existing.shops.push(shop);
  } else {
    cleanup.push({
      merchantIds: [merchantId],
      storeIds: [store.id],
      shops: [shop],
    });
  }

  return { shop, merchantId, store, legalEntityId };
}

async function seedInvoice(
  storeId: string,
  merchantId: string,
  legalEntityId: string,
  overrides: {
    shopifyOrderId?: string;
    buyerEmail?: string;
    buyerName?: string;
  } = {},
) {
  const seller = { name: "Acme", email: "billing@acme.test" };
  const buyer = {
    name: overrides.buyerName ?? "Buyer",
    email: overrides.buyerEmail ?? "buyer@example.com",
    phone: "+971500000000",
    trn: "TRN-KEEP",
    tin: "TIN-KEEP",
    address: { line1: "Buyer St", city: "Dubai", country: "AE" },
  };
  return prisma.invoice.create({
    data: {
      storeId,
      merchantId,
      legalEntityId: legalEntityId || merchantId,
      shopifyOrderId: overrides.shopifyOrderId ?? `order-${randomUUID()}`,
      shopifyOrderNumber: "#1001",
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      status: "issued",
      currency: "AED",
      issueDate: new Date("2026-01-15T00:00:00.000Z"),
      seller,
      buyer,
      shippingAddress: {
        line1: "Ship St",
        city: "Abu Dhabi",
        country: "AE",
      },
      lineItems: [],
      totals: { grandTotal: 250.5 },
      publicAccess: {
        tokenHash: "hash",
        token: "tok",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        issuedAt: new Date().toISOString(),
      },
    },
  });
}

async function seedCreditNote(
  storeId: string,
  merchantId: string,
  invoiceId: string,
  overrides: {
    shopifyOrderId?: string;
    buyerEmail?: string;
  } = {},
) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
  });
  return prisma.creditNote.create({
    data: {
      storeId,
      merchantId,
      invoiceId,
      shopifyOrderId: overrides.shopifyOrderId ?? invoice.shopifyOrderId,
      shopifyRefundId: `refund-${randomUUID()}`,
      creditNoteNumber: `CN-${randomUUID().slice(0, 8)}`,
      status: "issued",
      currency: "AED",
      issueDate: new Date("2026-01-20T00:00:00.000Z"),
      seller: invoice.seller as object,
      buyer: {
        name: "Buyer",
        email: overrides.buyerEmail ?? "buyer@example.com",
        phone: "+971500000000",
      },
      lineItems: [],
      totals: { grandTotal: 25 },
      publicAccessCreditNote: {
        tokenHash: "cn-hash",
        token: "cn-tok",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        issuedAt: new Date().toISOString(),
      },
      publicAccessRefundDocument: {
        tokenHash: "rd-hash",
        token: "rd-tok",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        issuedAt: new Date().toISOString(),
      },
    },
  });
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

describe("Group 17 Phase 2 — customers/data_request", () => {
  it("exports by order ID", async () => {
    const seeded = await seedMerchantShop();
    const orderId = `ord-${randomUUID()}`;
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { shopifyOrderId: orderId },
    );
    await seedInvoice(seeded.store.id, seeded.merchantId, seeded.legalEntityId!, {
      shopifyOrderId: `other-${randomUUID()}`,
      buyerEmail: "other@example.com",
    });

    const result = await handleCustomersDataRequest(seeded.shop, {
      orders_requested: [orderId],
      customer: { email: "nobody@example.com" },
      data_request: { id: 42 },
    });

    // Both order and email present → $or; order match wins for target invoice.
    assert.equal(result.invoices.length, 1);
    assert.equal(result.invoices[0].invoiceNumber, invoice.invoiceNumber);
    assert.equal(result.invoices[0].orderId, orderId);
    assert.equal(result.invoices[0].grandTotal, 250.5);
    assert.equal(result.dataRequestId, 42);
  });

  it("exports by customer email", async () => {
    const seeded = await seedMerchantShop();
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { buyerEmail: "match@example.com" },
    );
    await seedInvoice(seeded.store.id, seeded.merchantId, seeded.legalEntityId!, {
      buyerEmail: "skip@example.com",
    });

    const result = await handleCustomersDataRequest(seeded.shop, {
      customer: { email: "match@example.com" },
    });

    assert.equal(result.invoices.length, 1);
    assert.equal(result.invoices[0].invoiceNumber, invoice.invoiceNumber);
  });

  it("matches email case-insensitively", async () => {
    const seeded = await seedMerchantShop();
    await seedInvoice(seeded.store.id, seeded.merchantId, seeded.legalEntityId!, {
      buyerEmail: "Case.User@Example.COM",
    });

    const result = await handleCustomersDataRequest(seeded.shop, {
      customer: { email: "case.user@example.com" },
    });

    assert.equal(result.invoices.length, 1);
  });

  it("exports invoices and credit notes together", async () => {
    const seeded = await seedMerchantShop();
    const orderId = `ord-${randomUUID()}`;
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { shopifyOrderId: orderId, buyerEmail: "pair@example.com" },
    );
    const note = await seedCreditNote(
      seeded.store.id,
      seeded.merchantId,
      invoice.id,
      { shopifyOrderId: orderId, buyerEmail: "pair@example.com" },
    );

    const result = await handleCustomersDataRequest(seeded.shop, {
      orders_requested: [orderId],
      customer: { email: "pair@example.com" },
    });

    assert.equal(result.invoices.length, 1);
    assert.equal(result.creditNotes.length, 1);
    assert.equal(result.creditNotes[0].creditNoteNumber, note.creditNoteNumber);
    assert.equal(result.creditNotes[0].refundId, note.shopifyRefundId);
    assert.ok(result.creditNotes[0].buyer);
  });

  it("is safe when the store is missing", async () => {
    const ghost = `missing-${randomUUID()}.myshopify.com`;
    cleanup.push({ merchantIds: [], storeIds: [], shops: [ghost] });

    const result = await handleCustomersDataRequest(ghost, {
      orders_requested: ["1"],
      customer: { email: "a@b.com" },
    });

    assert.equal(result.invoices.length, 0);
    assert.equal(result.creditNotes.length, 0);
  });

  it("emails the export when Resend + business email are configured", async () => {
    const seeded = await seedMerchantShop();
    await seedInvoice(seeded.store.id, seeded.merchantId, seeded.legalEntityId!, {
      buyerEmail: "mailme@example.com",
    });
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@example.com";

    const sent: { to: string; subject: string; text: string }[] = [];
    setPrivacyDataRequestEmailForTests(async (input) => {
      sent.push({ to: input.to, subject: input.subject, text: input.text });
    });

    await handleCustomersDataRequest(seeded.shop, {
      customer: { email: "mailme@example.com" },
      data_request: { id: 7 },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "billing@acme.test");
    assert.match(sent[0].subject, /customer data request/);
    assert.match(sent[0].text, /mailme@example.com|INV-/);
  });

  it("email send failure does not break the webhook handler", async () => {
    const seeded = await seedMerchantShop();
    await seedInvoice(seeded.store.id, seeded.merchantId, seeded.legalEntityId!, {
      buyerEmail: "fail@example.com",
    });
    process.env.RESEND_API_KEY = "re_test_key";
    setPrivacyDataRequestEmailForTests(async () => {
      throw new Error("resend down");
    });

    await assert.doesNotReject(() =>
      handleCustomersDataRequest(seeded.shop, {
        customer: { email: "fail@example.com" },
      }),
    );
  });

  it("empty order+email filter exports all invoices but no credit notes (old $or:[] parity)", async () => {
    const seeded = await seedMerchantShop();
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
    );
    await seedCreditNote(seeded.store.id, seeded.merchantId, invoice.id);

    const result = await handleCustomersDataRequest(seeded.shop, {
      customer: {},
      orders_requested: [],
    });

    assert.equal(result.invoices.length, 1);
    assert.equal(result.creditNotes.length, 0);
  });
});

describe("Group 17 Phase 2 — customers/redact", () => {
  it("redacts by order ID", async () => {
    const seeded = await seedMerchantShop();
    const orderId = `ord-${randomUUID()}`;
    const target = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { shopifyOrderId: orderId },
    );
    const keep = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { shopifyOrderId: `keep-${randomUUID()}`, buyerEmail: "keep@example.com" },
    );

    await handleCustomersRedact(seeded.shop, {
      orders_to_redact: [orderId],
    });

    const redacted = await prisma.invoice.findUniqueOrThrow({
      where: { id: target.id },
    });
    const untouched = await prisma.invoice.findUniqueOrThrow({
      where: { id: keep.id },
    });
    assert.deepEqual(redacted.buyer, redactedBuyer());
    assert.equal(redacted.shippingAddress, null);
    assert.equal(redacted.publicAccess, null);
    assert.equal((untouched.buyer as { email?: string }).email, "keep@example.com");
    assert.ok(untouched.publicAccess);
  });

  it("redacts by email (case-insensitive)", async () => {
    const seeded = await seedMerchantShop();
    const target = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { buyerEmail: "Redact.Me@Example.com" },
    );

    await handleCustomersRedact(seeded.shop, {
      customer: { email: "redact.me@example.com" },
    });

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: target.id },
    });
    assert.deepEqual(row.buyer, redactedBuyer());
  });

  it("clears credit-note and refund-document public access; keeps records", async () => {
    const seeded = await seedMerchantShop();
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { buyerEmail: "cn@example.com" },
    );
    const note = await seedCreditNote(
      seeded.store.id,
      seeded.merchantId,
      invoice.id,
      { buyerEmail: "cn@example.com" },
    );

    await handleCustomersRedact(seeded.shop, {
      customer: { email: "cn@example.com" },
    });

    const updatedNote = await prisma.creditNote.findUniqueOrThrow({
      where: { id: note.id },
    });
    assert.ok(updatedNote);
    assert.deepEqual(updatedNote.buyer, redactedBuyer());
    assert.equal(updatedNote.publicAccessCreditNote, null);
    assert.equal(updatedNote.publicAccessRefundDocument, null);

    assert.ok(await prisma.invoice.findUnique({ where: { id: invoice.id } }));
  });

  it("empty filter redacts ALL store documents (old empty $or parity)", async () => {
    // Documented parity: when orders_to_redact and customer.email are both
    // missing, old Mongo filter is only { storeId } — every document is redacted.
    const seeded = await seedMerchantShop();
    const a = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { buyerEmail: "a@example.com" },
    );
    const b = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
      { buyerEmail: "b@example.com" },
    );
    const note = await seedCreditNote(
      seeded.store.id,
      seeded.merchantId,
      a.id,
      { buyerEmail: "a@example.com" },
    );

    await handleCustomersRedact(seeded.shop, { customer: {} });

    for (const id of [a.id, b.id]) {
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      assert.deepEqual(row.buyer, redactedBuyer());
      assert.equal(row.publicAccess, null);
    }
    const cn = await prisma.creditNote.findUniqueOrThrow({
      where: { id: note.id },
    });
    assert.deepEqual(cn.buyer, redactedBuyer());
  });

  it("is safe when the store is missing", async () => {
    const ghost = `missing-redact-${randomUUID()}.myshopify.com`;
    cleanup.push({ merchantIds: [], storeIds: [], shops: [ghost] });
    await assert.doesNotReject(() =>
      handleCustomersRedact(ghost, {
        orders_to_redact: ["1"],
        customer: { email: "x@y.com" },
      }),
    );
  });
});

describe("Group 17 Phase 2 — shop/redact", () => {
  it("deletes sessions, store-scoped data, and the store", async () => {
    const seeded = await seedMerchantShop();
    await createSession(seeded.shop, "a");
    await createSession(seeded.shop, "b");
    await prisma.shopBranding.create({
      data: { shop: seeded.shop, primaryColor: "#111111" },
    });
    await prisma.setting.create({
      data: {
        storeId: seeded.store.id,
        merchantId: seeded.merchantId,
        scope: "store",
        key: `pref-${randomUUID()}`,
        value: { on: true },
      },
    });
    const invoice = await seedInvoice(
      seeded.store.id,
      seeded.merchantId,
      seeded.legalEntityId!,
    );
    await prisma.invoiceStatusEvent.create({
      data: {
        invoiceId: invoice.id,
        status: "issued",
        source: "system",
      },
    });
    await seedCreditNote(seeded.store.id, seeded.merchantId, invoice.id);
    await prisma.invoiceTemplate.create({
      data: {
        storeId: seeded.store.id,
        merchantId: seeded.merchantId,
        code: `custom-${randomUUID().slice(0, 8)}`,
        name: "Custom",
        documentType: "tax_invoice",
        baseLayoutCode: "modern",
        isSystem: false,
        isActive: true,
        config: {},
      },
    });

    await handleShopRedact(seeded.shop);

    assert.equal(await prisma.session.count({ where: { shop: seeded.shop } }), 0);
    assert.equal(
      await prisma.invoice.count({ where: { storeId: seeded.store.id } }),
      0,
    );
    assert.equal(
      await prisma.creditNote.count({ where: { storeId: seeded.store.id } }),
      0,
    );
    assert.equal(
      await prisma.invoiceStatusEvent.count({
        where: { invoiceId: invoice.id },
      }),
      0,
    );
    assert.equal(
      await prisma.shopBranding.count({ where: { shop: seeded.shop } }),
      0,
    );
    assert.equal(
      await prisma.setting.count({ where: { storeId: seeded.store.id } }),
      0,
    );
    assert.equal(
      await prisma.invoiceTemplate.count({
        where: { storeId: seeded.store.id },
      }),
      0,
    );
    assert.equal(
      await prisma.store.count({ where: { id: seeded.store.id } }),
      0,
    );
    // Last store → merchant-level cleanup
    assert.equal(
      await prisma.merchant.count({ where: { id: seeded.merchantId } }),
      0,
    );
    assert.equal(
      await prisma.legalEntity.count({
        where: { merchantId: seeded.merchantId },
      }),
      0,
    );
  });

  it("does not touch another shop's data", async () => {
    const a = await seedMerchantShop();
    const b = await seedMerchantShop();
    await createSession(a.shop, "1");
    await createSession(b.shop, "1");
    const invB = await seedInvoice(b.store.id, b.merchantId, b.legalEntityId!);

    await handleShopRedact(a.shop);

    assert.equal(await prisma.session.count({ where: { shop: b.shop } }), 1);
    assert.ok(await prisma.store.findUnique({ where: { id: b.store.id } }));
    assert.ok(await prisma.invoice.findUnique({ where: { id: invB.id } }));
  });

  it("multi-store merchant keeps merchant-level data when another store remains", async () => {
    const first = await seedMerchantShop();
    const secondShop = `privacy-2-${randomUUID()}.myshopify.com`;
    const second = await seedMerchantShop({
      shop: secondShop,
      merchantId: first.merchantId,
      withLegal: false,
    });
    await seedInvoice(first.store.id, first.merchantId, first.legalEntityId!);

    await handleShopRedact(first.shop);

    assert.equal(
      await prisma.store.count({ where: { id: first.store.id } }),
      0,
    );
    assert.ok(await prisma.store.findUnique({ where: { id: second.store.id } }));
    assert.ok(
      await prisma.merchant.findUnique({ where: { id: first.merchantId } }),
    );
    assert.ok(
      await prisma.legalEntity.findUnique({
        where: { id: first.legalEntityId! },
      }),
    );
  });

  it("is safe when the store is missing", async () => {
    const ghost = `missing-shop-redact-${randomUUID()}.myshopify.com`;
    cleanup.push({ merchantIds: [], storeIds: [], shops: [ghost] });
    await createSession(ghost, "x");

    await assert.doesNotReject(() => handleShopRedact(ghost));
    assert.equal(await prisma.session.count({ where: { shop: ghost } }), 0);
  });
});

describe("Group 17 Phase 2 — webhook wiring", () => {
  it("registers compliance topics and routes to privacy handlers", () => {
    const toml = readFileSync(
      join(process.cwd(), "shopify.app.toml"),
      "utf8",
    );
    assert.match(toml, /compliance_topics\s*=\s*\[\s*"customers\/data_request"/);
    assert.match(toml, /compliance_topics\s*=\s*\[\s*"customers\/redact"/);
    assert.match(toml, /compliance_topics\s*=\s*\[\s*"shop\/redact"/);
    assert.match(toml, /uri\s*=\s*"\/webhooks\/customers\/data_request"/);
    assert.match(toml, /uri\s*=\s*"\/webhooks\/customers\/redact"/);
    assert.match(toml, /uri\s*=\s*"\/webhooks\/shop\/redact"/);

    const dataRequest = readFileSync(
      join(process.cwd(), "app/routes/webhooks.customers.data_request.tsx"),
      "utf8",
    );
    const customersRedact = readFileSync(
      join(process.cwd(), "app/routes/webhooks.customers.redact.tsx"),
      "utf8",
    );
    const shopRedact = readFileSync(
      join(process.cwd(), "app/routes/webhooks.shop.redact.tsx"),
      "utf8",
    );

    assert.match(dataRequest, /authenticate\.webhook/);
    assert.match(dataRequest, /handleCustomersDataRequest/);
    assert.match(customersRedact, /authenticate\.webhook/);
    assert.match(customersRedact, /handleCustomersRedact/);
    assert.match(shopRedact, /authenticate\.webhook/);
    assert.match(shopRedact, /handleShopRedact/);
    assert.doesNotMatch(dataRequest, /authenticate\.admin/);
    assert.doesNotMatch(customersRedact, /authenticate\.admin/);
    assert.doesNotMatch(shopRedact, /authenticate\.admin/);
  });
});
