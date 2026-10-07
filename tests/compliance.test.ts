/**
 * Group 16 — Compliance readiness, mode, ASP connect/disconnect, NoOp submit.
 */
import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  buildComplianceReadiness,
  connectStoreAsp,
  disconnectStoreAsp,
  getCompliancePageData,
  getComplianceReadiness,
  pintStrictForShop,
  setInvoiceMode,
} from "../app/models/compliance.server";
import {
  getAspAdapter,
  StorecoveAdapter,
  submitToAspJob,
} from "../app/models/asp";
import {
  createInvoiceFromShopifyOrder,
  restoreEnrichLineItemsForTests,
  setEnrichLineItemsForTests,
  type ShopifyOrder,
} from "../app/models/invoice-create.server";
import { encryptSecret } from "../app/utils/token-crypto";

function baseOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  const id = overrides.id ?? Math.floor(Math.random() * 1_000_000_000);
  return {
    id,
    order_number: id,
    name: overrides.name ?? `#${id}`,
    email: "buyer@example.com",
    currency: "AED",
    financial_status: "paid",
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
        quantity: 1,
        price: "100.00",
        total_discount: "0.00",
        tax_lines: [{ rate: 0.05, price: "5.00" }],
      },
    ],
    ...overrides,
  };
}

async function passthroughEnrich<T>(
  _shop: string,
  _orderLines: unknown[],
  lineItems: T[],
): Promise<T[]> {
  return lineItems;
}

const cleanup: Array<{ merchantId: string; storeId: string; shop: string }> =
  [];

afterEach(() => {
  restoreEnrichLineItemsForTests();
});

after(async () => {
  restoreEnrichLineItemsForTests();
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    const store = await prisma.store.findUnique({ where: { id: row.storeId } });
    if (store?.aspConnectionId) {
      await prisma.aspConnection.deleteMany({
        where: { id: store.aspConnectionId },
      });
    }
    await prisma.aspConnection.deleteMany({
      where: { legalEntity: { merchantId: row.merchantId } },
    });
    await prisma.legalEntity.deleteMany({
      where: { merchantId: row.merchantId },
    });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore(opts?: {
  completeLegalEntity?: boolean;
  withPhone?: boolean;
  withTin?: boolean;
  withTrn?: boolean;
  vatStatus?: string;
}) {
  const shop = `compliance-${randomUUID()}.myshopify.com`;
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
  cleanup.push({ merchantId: merchant.id, storeId: store.id, shop });

  if (opts?.completeLegalEntity !== false) {
    const entity = await prisma.legalEntity.create({
      data: {
        merchantId: merchant.id,
        legalName: "Acme Trading LLC",
        trn: opts?.withTrn === false ? null : "100000000000003",
        tin: opts?.withTin === false ? null : "1000000000",
        vatStatus: opts?.vatStatus ?? "registered",
        businessEmail: "billing@acme.test",
        businessPhone:
          opts?.withPhone === false ? null : "+971500000000",
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
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultLegalEntityId: entity.id },
    });
  }

  return { merchant, store, shop };
}

describe("Group 16 — readiness", () => {
  it("scores incomplete merchant with blockers", () => {
    const readiness = buildComplianceReadiness({
      legalEntity: null,
      aspConnected: false,
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.score, 0);
    assert.ok(readiness.blockers.includes("Company profile"));
    assert.ok(readiness.blockers.includes("ASP connection"));
    assert.equal(readiness.checks.length, 7);
  });

  it("flags missing legal name, TRN, TIN, contact, address, VAT, ASP", () => {
    const missingName = buildComplianceReadiness({
      legalEntity: {
        legalName: "  ",
        trn: "1",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(missingName.blockers.includes("Company profile"));

    const missingTrn = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(missingTrn.blockers.includes("Seller tax ID"));

    const missingTin = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(missingTin.blockers.includes("Seller TIN (Peppol ID)"));

    const missingContact = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(missingContact.blockers.includes("Business contact"));

    const missingAddress = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(missingAddress.blockers.includes("Registered address"));

    const notVat = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "2",
        vatStatus: "not_registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.ok(notVat.blockers.includes("VAT registration"));

    const noAsp = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: false,
    });
    assert.ok(noAsp.blockers.includes("ASP connection"));
    assert.equal(noAsp.score, Math.round((6 / 7) * 100));
  });

  it("ready when all checks pass", () => {
    const readiness = buildComplianceReadiness({
      legalEntity: {
        legalName: "Acme",
        trn: "1",
        tin: "2",
        vatStatus: "registered",
        businessEmail: "a@b.c",
        businessPhone: "1",
        address: { line1: "x", city: "y", country: "AE" },
      },
      aspConnected: true,
    });
    assert.equal(readiness.ready, true);
    assert.equal(readiness.score, 100);
    assert.deepEqual(readiness.blockers, []);
  });

  it("getComplianceReadiness loads store context", async () => {
    const { shop } = await seedStore({ withTin: false });
    const readiness = await getComplianceReadiness(shop);
    assert.ok(readiness);
    assert.equal(readiness!.ready, false);
    assert.ok(readiness!.blockers.includes("Seller TIN (Peppol ID)"));
    assert.ok(readiness!.blockers.includes("ASP connection"));
  });
});

describe("Group 16 — ASP connect / disconnect / mode", () => {
  it("connect validates key length and requires legal entity + participant", async () => {
    const bare = await seedStore({ completeLegalEntity: false });
    const noLe = await connectStoreAsp(bare.shop, { apiKey: "short" });
    assert.equal(noLe.ok, false);
    if (!noLe.ok) assert.match(noLe.error, /at least 8/);

    const noEntity = await connectStoreAsp(bare.shop, {
      apiKey: "12345678",
    });
    assert.equal(noEntity.ok, false);
    if (!noEntity.ok) assert.match(noEntity.error, /company setup/i);

    const { shop } = await seedStore({ withTin: false });
    const noParticipant = await connectStoreAsp(shop, {
      apiKey: "12345678",
    });
    assert.equal(noParticipant.ok, false);
    if (!noParticipant.ok) assert.match(noParticipant.error, /Participant ID/);
  });

  it("connect stores encrypted credentials and updates readiness", async () => {
    const { shop, store } = await seedStore();
    const result = await connectStoreAsp(shop, {
      apiKey: "storecove-test-key",
      participantId: "PART-1",
    });
    assert.equal(result.ok, true);

    const refreshed = await prisma.store.findUnique({
      where: { id: store.id },
    });
    assert.ok(refreshed?.aspConnectionId);
    const conn = await prisma.aspConnection.findUnique({
      where: { id: refreshed!.aspConnectionId! },
    });
    assert.equal(conn?.status, "connected");
    assert.equal(conn?.participantId, "PART-1");
    assert.equal(conn?.endpointScheme, "0088");
    assert.ok(conn?.credentialsRef?.startsWith("enc:v1:"));
    assert.doesNotMatch(conn!.credentialsRef!, /storecove-test-key/);

    const page = await getCompliancePageData(shop);
    assert.equal(page?.asp.connected, true);
    assert.equal(page?.readiness.ready, true);
    assert.ok(!("credentialsRef" in (page?.asp ?? {})));
  });

  it("cannot enable compliance until ready; then mode flips", async () => {
    const { shop } = await seedStore();
    const blocked = await setInvoiceMode(shop, "compliance");
    assert.equal(blocked.ok, false);

    await connectStoreAsp(shop, { apiKey: "storecove-test-key" });
    const enabled = await setInvoiceMode(shop, "compliance");
    assert.equal(enabled.ok, true);
    assert.equal(await pintStrictForShop(shop), true);

    const page = await getCompliancePageData(shop);
    assert.equal(page?.invoiceMode, "compliance");
    assert.equal(page?.complianceReady, true);

    const disconnectBlocked = await disconnectStoreAsp(shop);
    assert.equal(disconnectBlocked.ok, false);
    if (!disconnectBlocked.ok) {
      assert.match(disconnectBlocked.error, /Standard mode/);
    }

    const standard = await setInvoiceMode(shop, "standard");
    assert.equal(standard.ok, true);
    assert.equal(await pintStrictForShop(shop), false);

    const disconnected = await disconnectStoreAsp(shop);
    assert.equal(disconnected.ok, true);
    const after = await getCompliancePageData(shop);
    assert.equal(after?.asp.connected, false);
    assert.equal(after?.complianceReady, false);
  });

  it("reconnect uses endpointScheme 0235 on existing connection", async () => {
    const { shop, store } = await seedStore();
    await connectStoreAsp(shop, { apiKey: "first-key-xx" });
    await connectStoreAsp(shop, { apiKey: "second-key-yy" });
    const refreshed = await prisma.store.findUnique({
      where: { id: store.id },
    });
    const conn = await prisma.aspConnection.findUnique({
      where: { id: refreshed!.aspConnectionId! },
    });
    assert.equal(conn?.endpointScheme, "0235");
  });
});

describe("Group 16 — ASP adapter stubs", () => {
  it("factory always returns NoOp; Storecove constructor throws", async () => {
    const { store } = await seedStore();
    await connectStoreAsp(store.shopifyDomain, { apiKey: "storecove-key" });
    await setInvoiceMode(store.shopifyDomain, "compliance");
    const updated = await prisma.store.findUnique({ where: { id: store.id } });
    const adapter = getAspAdapter(updated!);
    assert.equal(adapter.providerCode, "noop");
    const submit = await adapter.submitInvoice({});
    assert.equal(submit.status, "skipped");

    assert.throws(
      () => new StorecoveAdapter("x"),
      /not implemented/i,
    );
  });

  it("submitToAspJob skips without mutating invoice when standard", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { store, shop } = await seedStore();
    const invoice = await createInvoiceFromShopifyOrder(
      shop,
      baseOrder(),
      "sync",
    );
    assert.ok(invoice);
    assert.equal(invoice!.mode, "standard");

    const result = await submitToAspJob({
      storeId: store.id,
      invoiceId: invoice!.id,
      invoice: { id: invoice!.id },
    });
    assert.equal(result.status, "skipped");
    const reloaded = await prisma.invoice.findUnique({
      where: { id: invoice!.id },
    });
    assert.equal(reloaded?.aspStatus, null);
    assert.equal(reloaded?.status, "generated");
  });

  it("invoice creation snapshots compliance mode without ASP submit", async () => {
    setEnrichLineItemsForTests(passthroughEnrich);
    const { shop } = await seedStore();
    await connectStoreAsp(shop, { apiKey: "storecove-key" });
    await setInvoiceMode(shop, "compliance");

    const invoice = await createInvoiceFromShopifyOrder(
      shop,
      baseOrder({ name: "#compliance" }),
      "sync",
    );
    assert.ok(invoice);
    assert.equal(invoice!.mode, "compliance");
    assert.equal(invoice!.aspStatus, null);
  });
});

describe("Group 16 — store isolation + route wiring", () => {
  it("foreign shop cannot see another store readiness", async () => {
    const a = await seedStore();
    await connectStoreAsp(a.shop, { apiKey: "storecove-key" });
    const b = await seedStore({ withTin: false });
    const readinessB = await getComplianceReadiness(b.shop);
    assert.ok(readinessB);
    assert.equal(readinessB!.ready, false);
    const pageA = await getCompliancePageData(a.shop);
    assert.equal(pageA?.asp.connected, true);
    const pageB = await getCompliancePageData(b.shop);
    assert.equal(pageB?.asp.connected, false);
  });

  it("compliance route and nav are wired; credentials never in page source", () => {
    const route = readFileSync(
      join(process.cwd(), "app/routes/app.compliance.tsx"),
      "utf8",
    );
    assert.match(route, /authenticate\.admin/);
    assert.match(route, /getCompliancePageData/);
    assert.match(route, /connectStoreAsp/);
    assert.match(route, /disconnectStoreAsp/);
    assert.match(route, /setInvoiceMode/);
    assert.doesNotMatch(route, /credentialsRef/);

    const nav = readFileSync(
      join(process.cwd(), "app/routes/app.tsx"),
      "utf8",
    );
    assert.match(nav, /href="\/app\/compliance"/);
  });
});
