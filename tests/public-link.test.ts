/**
 * Group 13 Phase A — public-link token issue / reuse / resolve.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createHash, createHmac, randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  hashPublicToken,
  inspectSignedPublicToken,
  issueCreditNotePublicLink,
  issueCreditNotePublicLinkForShop,
  issueInvoicePublicLink,
  issueInvoicePublicLinkForShop,
  LINK_TTL_MS,
  resolveCreditNoteByPublicToken,
  resolveInvoiceByPublicToken,
  type PublicAccessRecord,
} from "../app/models/public-link.server";
import { encryptSecret } from "../app/utils/token-crypto";

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

function linkSecret(): string {
  return (
    process.env.ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "dev-public-link-secret"
  );
}

function signPayload(payload: { i: string; e: number; t: string }): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", linkSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function tokenFromUrl(url: string): string {
  const parts = url.split("/");
  return decodeURIComponent(parts[parts.length - 1] || "");
}

async function seedStore(opts?: { status?: string; shopifyDomain?: string }) {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: opts?.shopifyDomain ?? `pl-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: opts?.status ?? "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

async function seedInvoice(storeId: string, merchantId: string) {
  return prisma.invoice.create({
    data: {
      merchantId,
      storeId,
      legalEntityId: merchantId,
      shopifyOrderId: `gid://shopify/Order/${randomUUID()}`,
      shopifyOrderNumber: "#1001",
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      mode: "standard",
      status: "generated",
      issueDate: new Date(),
      currency: "AED",
      seller: { name: "Seller", trn: "100" },
      buyer: { name: "Buyer", email: "buyer@example.com" },
      lineItems: [],
      totals: {
        subtotal: 100,
        discountTotal: 0,
        vatTotal: 5,
        shipping: 0,
        grandTotal: 105,
      },
    },
  });
}

async function seedCreditNote(
  storeId: string,
  merchantId: string,
  invoiceId: string,
) {
  return prisma.creditNote.create({
    data: {
      merchantId,
      storeId,
      invoiceId,
      shopifyRefundId: `gid://shopify/Refund/${randomUUID()}`,
      shopifyOrderId: `gid://shopify/Order/${randomUUID()}`,
      creditNoteNumber: `CN-${randomUUID().slice(0, 8)}`,
      status: "generated",
      issueDate: new Date(),
      currency: "AED",
      seller: { name: "Seller", trn: "100" },
      buyer: { name: "Buyer", email: "buyer@example.com" },
      lineItems: [],
      totals: {
        subtotal: 50,
        discountTotal: 0,
        vatTotal: 2.5,
        shipping: 0,
        grandTotal: 52.5,
      },
    },
  });
}

describe("Group 13 Phase A — public-link tokens", () => {
  it("creates invoice, credit note, and refund document tokens with correct types and ids", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    assert.ok(inv?.ok);
    assert.ok(cn?.ok);
    assert.ok(rd?.ok);

    const invToken = tokenFromUrl(inv!.url);
    const cnToken = tokenFromUrl(cn!.url);
    const rdToken = tokenFromUrl(rd!.url);

    const invPayload = inspectSignedPublicToken(invToken);
    const cnPayload = inspectSignedPublicToken(cnToken);
    const rdPayload = inspectSignedPublicToken(rdToken);

    assert.equal(invPayload?.t, "inv");
    assert.equal(invPayload?.i, invoice.id);
    assert.equal(cnPayload?.t, "cn");
    assert.equal(cnPayload?.i, creditNote.id);
    assert.equal(rdPayload?.t, "rd");
    assert.equal(rdPayload?.i, creditNote.id);

    assert.match(inv!.url, /\/public\/invoices\//);
    assert.match(cn!.url, /\/public\/credit-notes\//);
    assert.match(rd!.url, /\/public\/refund-documents\//);

    // CN and RD access objects remain separate
    const refreshed = await prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNote.id },
    });
    const cnAccess = refreshed.publicAccessCreditNote as PublicAccessRecord;
    const rdAccess = refreshed.publicAccessRefundDocument as PublicAccessRecord;
    assert.ok(cnAccess?.token);
    assert.ok(rdAccess?.token);
    assert.notEqual(cnAccess.token, rdAccess.token);
  });

  it("packing slips do not receive a public token API", async () => {
    const mod = await import("../app/models/public-link.server");
    assert.equal(
      "issuePackingSlipPublicLink" in mod,
      false,
      "packing slips must not have a public-link issuer",
    );
  });

  it("uses 30-day TTL, HMAC signature, and SHA-256 tokenHash", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const before = Date.now();
    const issued = await issueInvoicePublicLink(invoice.id);
    assert.ok(issued?.ok);

    const token = tokenFromUrl(issued!.url);
    const payload = inspectSignedPublicToken(token);
    assert.ok(payload);

    const ttl = payload!.e - before;
    assert.ok(
      ttl >= LINK_TTL_MS - 5_000 && ttl <= LINK_TTL_MS + 5_000,
      `TTL drift: ${ttl}`,
    );
    assert.equal(LINK_TTL_MS, 30 * 24 * 60 * 60 * 1000);

    const expectedHash = createHash("sha256").update(token).digest("hex");
    assert.equal(hashPublicToken(token), expectedHash);

    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const access = stored.publicAccess as PublicAccessRecord;
    assert.equal(access.tokenHash, expectedHash);
    assert.equal(access.token, token);

    // HMAC must match secret
    const [body, sig] = token.split(".");
    const expectedSig = createHmac("sha256", linkSecret())
      .update(body)
      .digest("base64url");
    assert.equal(sig, expectedSig);
  });

  it("resolves valid invoice, credit note, and refund tokens", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    const invResolved = await resolveInvoiceByPublicToken(
      tokenFromUrl(inv!.url),
    );
    const cnResolved = await resolveCreditNoteByPublicToken(
      tokenFromUrl(cn!.url),
      "credit_note",
    );
    const rdResolved = await resolveCreditNoteByPublicToken(
      tokenFromUrl(rd!.url),
      "refund_document",
    );

    assert.equal(invResolved?.invoice.id, invoice.id);
    assert.equal(invResolved?.shopDomain, store.shopifyDomain);
    assert.equal(cnResolved?.creditNote.id, creditNote.id);
    assert.equal(cnResolved?.documentType, "credit_note");
    assert.equal(rdResolved?.creditNote.id, creditNote.id);
    assert.equal(rdResolved?.documentType, "refund_document");
  });

  it("rejects wrong document type and wrong document id", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const invToken = tokenFromUrl(inv!.url);
    const cnToken = tokenFromUrl(cn!.url);

    assert.equal(
      await resolveCreditNoteByPublicToken(invToken, "credit_note"),
      null,
    );
    assert.equal(await resolveInvoiceByPublicToken(cnToken), null);
    assert.equal(
      await resolveCreditNoteByPublicToken(cnToken, "refund_document"),
      null,
    );

    const ghost = signPayload({
      i: "does-not-exist",
      e: Date.now() + LINK_TTL_MS,
      t: "inv",
    });
    assert.equal(await resolveInvoiceByPublicToken(ghost), null);
  });

  it("rejects expired, unknown, and invalid-signature tokens", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const expired = signPayload({
      i: invoice.id,
      e: Date.now() - 1_000,
      t: "inv",
    });
    assert.equal(await resolveInvoiceByPublicToken(expired), null);

    assert.equal(await resolveInvoiceByPublicToken("totally-unknown-token"), null);
    assert.equal(await resolveInvoiceByPublicToken(""), null);

    const issued = await issueInvoicePublicLink(invoice.id);
    const token = tokenFromUrl(issued!.url);
    const [body] = token.split(".");
    const badSig = `${body}.AAAAAAAAAAAAAAAAAAAAAA`;
    assert.equal(await resolveInvoiceByPublicToken(badSig), null);
  });

  it("reuses an existing valid token and replaces when <= 60s remain", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const first = await issueInvoicePublicLink(invoice.id);
    const second = await issueInvoicePublicLink(invoice.id);
    assert.equal(first!.url, second!.url);
    assert.equal(
      first!.expiresAt.getTime(),
      second!.expiresAt.getTime(),
    );

    const oldToken = tokenFromUrl(first!.url);
    const nearExpiry = new Date(Date.now() + 30_000);
    const nearToken = signPayload({
      i: invoice.id,
      e: nearExpiry.getTime(),
      t: "inv",
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        publicAccess: {
          tokenHash: hashPublicToken(nearToken),
          token: nearToken,
          expiresAt: nearExpiry.toISOString(),
          issuedAt: new Date().toISOString(),
        },
      },
    });

    const replaced = await issueInvoicePublicLink(invoice.id);
    assert.ok(replaced?.ok);
    const newToken = tokenFromUrl(replaced!.url);
    assert.notEqual(newToken, nearToken);
    assert.notEqual(newToken, oldToken);
    assert.ok(await resolveInvoiceByPublicToken(newToken));

    // Old parity: signed resolve does not consult stored publicAccess.
    // A still-unexpired signed token continues to resolve until payload.e.
    // Replacement only updates storage / merchant reuse; it does not revoke
    // prior HMAC tokens cryptographically.
    assert.ok(await resolveInvoiceByPublicToken(nearToken));

    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const access = stored.publicAccess as PublicAccessRecord;
    assert.equal(access.token, newToken);
  });

  it("replacing stored access updates reuse; legacy opaque old token stops resolving", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const opaqueOld = `opaque-${randomUUID()}`;
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        publicAccess: {
          tokenHash: hashPublicToken(opaqueOld),
          token: opaqueOld,
          expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString(),
          issuedAt: new Date().toISOString(),
        },
      },
    });
    assert.ok(await resolveInvoiceByPublicToken(opaqueOld));

    const issued = await issueInvoicePublicLink(invoice.id);
    assert.ok(issued?.ok);
    const newToken = tokenFromUrl(issued!.url);
    assert.notEqual(newToken, opaqueOld);

    // Legacy hash no longer matches stored publicAccess.tokenHash.
    assert.equal(await resolveInvoiceByPublicToken(opaqueOld), null);
    assert.ok(await resolveInvoiceByPublicToken(newToken));

    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const access = stored.publicAccess as PublicAccessRecord;
    assert.equal(access.token, newToken);
  });

  it("supports legacy opaque tokenHash lookup", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const opaque = `legacy-opaque-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        publicAccess: {
          tokenHash: hashPublicToken(opaque),
          token: opaque,
          expiresAt: expiresAt.toISOString(),
          issuedAt: new Date().toISOString(),
        },
      },
    });

    const resolved = await resolveInvoiceByPublicToken(opaque);
    assert.equal(resolved?.invoice.id, invoice.id);
    assert.equal(resolved?.shopDomain, store.shopifyDomain);

    const cnInvoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(
      store.id,
      merchant.id,
      cnInvoice.id,
    );
    const cnOpaque = `legacy-cn-${randomUUID()}`;
    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: {
        publicAccessCreditNote: {
          tokenHash: hashPublicToken(cnOpaque),
          token: cnOpaque,
          expiresAt: expiresAt.toISOString(),
          issuedAt: new Date().toISOString(),
        },
      },
    });
    const cnResolved = await resolveCreditNoteByPublicToken(
      cnOpaque,
      "credit_note",
    );
    assert.equal(cnResolved?.creditNote.id, creditNote.id);
  });

  it("rejects missing store domain; inactive store with domain still resolves (old parity)", async () => {
    const { merchant, store } = await seedStore({ status: "uninstalled" });
    const invoice = await seedInvoice(store.id, merchant.id);
    const issued = await issueInvoicePublicLink(invoice.id);
    const token = tokenFromUrl(issued!.url);

    // Old app only checks shopifyDomain — status is ignored.
    const stillOk = await resolveInvoiceByPublicToken(token);
    assert.equal(stillOk?.invoice.id, invoice.id);

    await prisma.store.update({
      where: { id: store.id },
      data: { shopifyDomain: "" },
    });
    assert.equal(await resolveInvoiceByPublicToken(token), null);
  });

  it("token issuance creates no InvoiceStatusEvent and no download event", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const before = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    await issueInvoicePublicLink(invoice.id);
    const after = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    assert.equal(after, before);

    const refreshed = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    assert.equal(refreshed.status, "generated");
  });
});

describe("Phase D — shop-scoped issue helpers", () => {
  it("issueInvoicePublicLinkForShop verifies shop ownership and reuses URL", async () => {
    const { merchant, store } = await seedStore();
    const other = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const first = await issueInvoicePublicLinkForShop(
      store.shopifyDomain,
      invoice.id,
    );
    assert.ok(first);
    assert.match(first!.url, /\/public\/invoices\//);

    const second = await issueInvoicePublicLinkForShop(
      store.shopifyDomain,
      invoice.id,
    );
    assert.equal(second!.url, first!.url);

    const foreign = await issueInvoicePublicLinkForShop(
      other.store.shopifyDomain,
      invoice.id,
    );
    assert.equal(foreign, null);
  });

  it("issueCreditNotePublicLinkForShop separates credit_note and refund_document URLs", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const note = await seedCreditNote(store.id, merchant.id, invoice.id);

    const cn = await issueCreditNotePublicLinkForShop(
      store.shopifyDomain,
      note.id,
      "credit_note",
    );
    const rd = await issueCreditNotePublicLinkForShop(
      store.shopifyDomain,
      note.id,
      "refund_document",
    );
    assert.ok(cn);
    assert.ok(rd);
    assert.match(cn!.url, /\/public\/credit-notes\//);
    assert.match(rd!.url, /\/public\/refund-documents\//);
    assert.notEqual(cn!.url, rd!.url);

    const cnAgain = await issueCreditNotePublicLinkForShop(
      store.shopifyDomain,
      note.id,
      "credit_note",
    );
    assert.equal(cnAgain!.url, cn!.url);
  });
});
