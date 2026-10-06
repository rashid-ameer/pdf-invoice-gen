/**
 * Group 13 Phase C — integrity hash, verification HMAC, QR activation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHmac, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import prisma from "../app/db.server";
import {
  computeIntegrityHash,
  ensureCreditNoteIntegrityHash,
  ensureInvoiceIntegrityHash,
  integrityDisplayCode,
  signVerificationUrl,
  toIntegrityDocument,
  verifyCreditNoteDocument,
  verifyInvoiceDocument,
  verifySignature,
  buildInvoiceVerification,
  buildCreditNoteVerification,
  buildVerifyUrl,
  type IntegrityDocument,
} from "../app/models/verification.server";
import { renderDocumentVerificationPage } from "../app/models/document-verification.server";
import {
  renderInvoiceDocument,
  renderPackingSlipDocument,
} from "../app/models/invoice-document.server";
import {
  renderCreditNoteDocument,
  renderRefundDocument,
} from "../app/models/credit-note-document.server";
import { handlePublicInvoiceView } from "../app/models/public-document.server";
import { issueInvoicePublicLink } from "../app/models/public-link.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import { encryptSecret } from "../app/utils/token-crypto";
import { DEFAULT_CURRENCY } from "../app/constants/app";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

before(async () => {
  await ensureSystemTemplates();
});

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

function verificationSecret(): string {
  return (
    process.env.ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "dev-verification-secret"
  );
}

function fixtureDoc(overrides: Partial<IntegrityDocument> = {}): IntegrityDocument {
  return {
    invoiceNumber: "INV-1001",
    creditNoteNumber: "CN-1001",
    issueDate: new Date("2024-06-15T12:00:00.000Z"),
    currency: "AED",
    seller: { legalName: "Acme Trading LLC", trn: "100000000000003" },
    buyer: { name: "Buyer Co" },
    lineItems: [
      {
        description: "Widget",
        quantity: 2,
        unitPrice: 10.555,
        discount: 0.1,
        vatRate: 5,
        vatAmount: 1.05,
        lineTotal: 21.06,
      },
    ],
    totals: {
      subtotal: 21.01,
      discount: 0.1,
      vatTotal: 1.05,
      shipping: 0,
      grandTotal: 22.06,
    },
    ...overrides,
  };
}

/** Independent old-algorithm reference for parity checks. */
function expectedOldHash(doc: IntegrityDocument, kind: string): string {
  const roundMoney = (value: number) =>
    (Math.round(value * 100) / 100).toFixed(2);
  const documentNumber =
    kind === "invoice"
      ? (doc.invoiceNumber ?? "")
      : (doc.creditNoteNumber ?? doc.invoiceNumber ?? "");
  const payload = {
    kind,
    documentNumber,
    issueDate: doc.issueDate
      ? new Date(doc.issueDate).toISOString().slice(0, 10)
      : "",
    currency: doc.currency ?? DEFAULT_CURRENCY,
    sellerTrn: doc.seller?.trn ?? "",
    sellerName: doc.seller?.legalName ?? "",
    buyerName: doc.buyer?.name ?? "",
    lineItems: doc.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      discount: roundMoney(item.discount ?? 0),
      vatRate: item.vatRate ?? 0,
      vatAmount: roundMoney(item.vatAmount),
      lineTotal: roundMoney(item.lineTotal),
    })),
    totals: {
      subtotal: roundMoney(doc.totals.subtotal),
      discount: roundMoney(doc.totals.discount ?? 0),
      vatTotal: roundMoney(doc.totals.vatTotal),
      shipping: roundMoney(doc.totals.shipping ?? 0),
      grandTotal: roundMoney(doc.totals.grandTotal),
    },
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `vf-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
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
      shopifyOrderNumber: "#3001",
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      mode: "standard",
      status: "generated",
      issueDate: new Date("2024-06-15T12:00:00.000Z"),
      currency: "AED",
      seller: {
        legalName: "Acme Trading LLC",
        trn: "100000000000003",
        address: { line1: "Street 1", city: "Dubai", emirate: "DU", country: "AE" },
      },
      buyer: { name: "Buyer Co", email: "buyer@example.com" },
      lineItems: [
        {
          sku: "SKU-A",
          description: "Widget",
          quantity: 2,
          unitPrice: 10.555,
          discount: 0.1,
          vatRate: 5,
          vatAmount: 1.05,
          lineTotal: 21.06,
        },
      ],
      totals: {
        subtotal: 21.01,
        discount: 0.1,
        vatTotal: 1.05,
        shipping: 0,
        grandTotal: 22.06,
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
      issueDate: new Date("2024-06-16T12:00:00.000Z"),
      currency: "AED",
      seller: {
        legalName: "Acme Trading LLC",
        trn: "100000000000003",
        address: { line1: "Street 1", city: "Dubai", emirate: "DU", country: "AE" },
      },
      buyer: { name: "Buyer Co", email: "buyer@example.com" },
      lineItems: [
        {
          sku: "SKU-A",
          description: "Widget",
          quantity: 1,
          unitPrice: 10.555,
          discount: 0,
          vatRate: 5,
          vatAmount: 0.53,
          lineTotal: 10.55,
        },
      ],
      totals: {
        subtotal: 10.55,
        discount: 0,
        vatTotal: 0.53,
        shipping: 0,
        grandTotal: 11.08,
      },
    },
  });
}

function assertNoAuthInRoute(filename: string) {
  const filePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "app",
    "routes",
    filename,
  );
  const src = readFileSync(filePath, "utf8");
  assert.equal(/from\s+["'].*shopify\.server["']/.test(src), false);
  assert.equal(/authenticate\.admin\s*\(/.test(src), false);
}

describe("Group 13 Phase C — integrity hash", () => {
  it("matches the old computeIntegrityHash algorithm for invoice and credit note", () => {
    const doc = fixtureDoc();
    const invHash = computeIntegrityHash(doc, "invoice");
    const cnHash = computeIntegrityHash(doc, "credit_note");
    assert.equal(invHash, expectedOldHash(doc, "invoice"));
    assert.equal(cnHash, expectedOldHash(doc, "credit_note"));
    assert.notEqual(invHash, cnHash);
    assert.equal(integrityDisplayCode(invHash).length, 8);
    assert.equal(integrityDisplayCode(invHash), invHash.slice(0, 8).toUpperCase());
  });

  it("normalizes money and issue date like the old app", () => {
    const doc = fixtureDoc({
      issueDate: new Date("2024-01-05T23:30:00.000Z"),
      lineItems: [
        {
          description: "A",
          quantity: 1,
          unitPrice: 1.005,
          vatAmount: 0.05,
          lineTotal: 1.06,
        },
      ],
      totals: {
        subtotal: 1.005,
        vatTotal: 0.05,
        grandTotal: 1.055,
      },
    });
    const hash = computeIntegrityHash(doc, "invoice");
    // 1.005 → 1.01 after round; date → UTC YYYY-MM-DD
    assert.equal(hash, expectedOldHash(doc, "invoice"));
    assert.match(JSON.stringify({ d: new Date(doc.issueDate!).toISOString().slice(0, 10) }), /2024-01-05/);
  });

  it("lazily seals invoice hash once and does not overwrite", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    assert.equal(invoice.verification, null);

    const first = await ensureInvoiceIntegrityHash(invoice.id);
    assert.ok(first);
    const afterFirst = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const stored = afterFirst.verification as { integrityHash: string };
    assert.equal(stored.integrityHash, first);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        totals: {
          subtotal: 999,
          discount: 0,
          vatTotal: 0,
          shipping: 0,
          grandTotal: 999,
        },
      },
    });

    const second = await ensureInvoiceIntegrityHash(invoice.id);
    assert.equal(second, first);

    const afterSecond = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    assert.equal(
      (afterSecond.verification as { integrityHash: string }).integrityHash,
      first,
    );
  });

  it("credit note hash uses shared verification field; kind affects payload", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const cn = await seedCreditNote(store.id, merchant.id, invoice.id);

    const sealed = await ensureCreditNoteIntegrityHash(cn.id, "credit_note");
    assert.ok(sealed);

    const refundHash = computeIntegrityHash(
      toIntegrityDocument(await prisma.creditNote.findUniqueOrThrow({ where: { id: cn.id } })),
      "refund_document",
    );
    assert.notEqual(sealed, refundHash);

    // First seal wins — refund ensure returns stored CN hash (old shared-field quirk).
    const again = await ensureCreditNoteIntegrityHash(cn.id, "refund_document");
    assert.equal(again, sealed);
  });

  it("hash changes when relevant document data changes before seal", async () => {
    const a = fixtureDoc({ buyer: { name: "A" } });
    const b = fixtureDoc({ buyer: { name: "B" } });
    assert.notEqual(
      computeIntegrityHash(a, "invoice"),
      computeIntegrityHash(b, "invoice"),
    );
  });
});

describe("Group 13 Phase C — verification signature", () => {
  it("signs with HMAC-SHA256 truncated to 22 base64url chars", () => {
    const id = "doc-123";
    const sig = signVerificationUrl(id, "invoice");
    assert.equal(sig.length, 22);

    const full = createHmac("sha256", verificationSecret())
      .update(`invoice:${id}`)
      .digest("base64url");
    assert.equal(sig, full.slice(0, 22));
    assert.equal(verifySignature(id, "invoice", sig), true);
    assert.equal(verifySignature(id, "invoice", "bad"), false);
    assert.equal(verifySignature(id, "invoice", sig.slice(0, 10)), false);
    assert.equal(verifySignature(id, "credit_note", sig), false);
  });
});

describe("Group 13 Phase C — verification results", () => {
  it("valid invoice/CN/refund signatures return authentic; invalid/missing fail", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const cn = await seedCreditNote(store.id, merchant.id, invoice.id);

    await ensureInvoiceIntegrityHash(invoice.id);
    await ensureCreditNoteIntegrityHash(cn.id, "credit_note");

    const invSig = signVerificationUrl(invoice.id, "invoice");
    const cnSig = signVerificationUrl(cn.id, "credit_note");
    const rdSig = signVerificationUrl(cn.id, "refund_document");

    const inv = await verifyInvoiceDocument(invoice.id, invSig);
    assert.equal(inv.ok, true);
    if (inv.ok) {
      assert.equal(inv.authentic, true);
      assert.equal(inv.tampered, false);
      assert.equal(inv.documentNumber, invoice.invoiceNumber);
      assert.match(inv.storeName, /myshopify\.com/);
    }

    const cnRes = await verifyCreditNoteDocument(cn.id, cnSig, "credit_note");
    assert.equal(cnRes.ok, true);
    if (cnRes.ok) assert.equal(cnRes.authentic, true);

    // Shared hash sealed as credit_note; refund verify recomputes with refund kind → tampered (old quirk).
    const rdRes = await verifyCreditNoteDocument(cn.id, rdSig, "refund_document");
    assert.equal(rdRes.ok, true);
    if (rdRes.ok) {
      assert.equal(rdRes.tampered, true);
      assert.equal(rdRes.authentic, false);
    }

    const bad = await verifyInvoiceDocument(invoice.id, "xxxxxxxxxxxxxxxxxxxxxx");
    assert.deepEqual(bad, { ok: false, reason: "invalid_link" });

    const missing = await verifyInvoiceDocument(
      "missing-id",
      signVerificationUrl("missing-id", "invoice"),
    );
    assert.deepEqual(missing, { ok: false, reason: "not_found" });

    const page = renderDocumentVerificationPage(bad);
    assert.match(page, /invalid or has been tampered with/i);
    assert.match(renderDocumentVerificationPage(missing), /could not be found/i);
    assert.match(renderDocumentVerificationPage(inv), /Verified authentic/);
  });

  it("missing stored hash is not treated as tampered; mismatch is tampered", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const sig = signVerificationUrl(invoice.id, "invoice");

    const noSeal = await verifyInvoiceDocument(invoice.id, sig);
    assert.equal(noSeal.ok, true);
    if (noSeal.ok) {
      assert.equal(noSeal.tampered, false);
      assert.equal(noSeal.authentic, true);
    }

    await ensureInvoiceIntegrityHash(invoice.id);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        totals: {
          subtotal: 1,
          discount: 0,
          vatTotal: 0,
          shipping: 0,
          grandTotal: 1,
        },
      },
    });
    const mismatched = await verifyInvoiceDocument(invoice.id, sig);
    assert.equal(mismatched.ok, true);
    if (mismatched.ok) {
      assert.equal(mismatched.tampered, true);
      assert.equal(mismatched.authentic, false);
    }
    assert.match(renderDocumentVerificationPage(mismatched), /Document modified/);
  });

  it("verification routes do not use admin authentication", () => {
    assertNoAuthInRoute("verify.invoices_.$id.$signature.tsx");
    assertNoAuthInRoute("verify.credit-notes_.$id.$signature.tsx");
    assertNoAuthInRoute("verify.refund-documents_.$id.$signature.tsx");
  });
});

describe("Group 13 Phase C — QR activation", () => {
  it("invoice QR appears for tax_invoice when enabled and seals integrity", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const doc = await renderInvoiceDocument(store.shopifyDomain, invoice.id);
    assert.ok(doc);
    assert.match(doc!.html, /data-section="verification_qr"/);
    assert.match(doc!.html, /Scan to verify/);
    assert.match(doc!.html, /data:image\/png;base64,/);

    const refreshed = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const sealed = refreshed.verification as { integrityHash: string };
    assert.ok(sealed?.integrityHash);

    const payload = await buildInvoiceVerification(invoice.id);
    assert.ok(payload);
    assert.match(payload!.verifyUrl, /\/verify\/invoices\//);
    assert.equal(payload!.verifyUrl.includes("/public/"), false);
    assert.ok(doc!.html.includes(payload!.integrityCode));
  });

  it("packing slip never receives verification QR and does not seal", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const doc = await renderPackingSlipDocument(store.shopifyDomain, invoice.id);
    assert.ok(doc);
    assert.equal(doc!.html.includes('data-section="verification_qr"'), false);

    const refreshed = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    assert.equal(refreshed.verification, null);
  });

  it("QR disabled does not seal integrity on tax invoice", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const packingTpl = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, documentType: "packing_slip", isActive: true },
    });
    assert.ok(packingTpl);

    // packing_slip template has qrCode.visible=false; tax_invoice gate alone is not enough.
    const doc = await renderInvoiceDocument(
      store.shopifyDomain,
      invoice.id,
      packingTpl!.id,
    );
    assert.ok(doc);
    assert.equal(doc!.html.includes('data-section="verification_qr"'), false);

    const refreshed = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    assert.equal(refreshed.verification, null);
  });

  it("credit note and refund document QR when enabled", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const cn = await seedCreditNote(store.id, merchant.id, invoice.id);

    const cnDoc = await renderCreditNoteDocument(store.shopifyDomain, cn.id);
    assert.ok(cnDoc);
    assert.match(cnDoc!.html, /data-section="verification_qr"/);

    const rdDoc = await renderRefundDocument(store.shopifyDomain, cn.id);
    assert.ok(rdDoc);
    assert.match(rdDoc!.html, /data-section="verification_qr"/);

    const cnPayload = await buildCreditNoteVerification(cn.id, "credit_note");
    const rdPayload = await buildCreditNoteVerification(cn.id, "refund_document");
    assert.match(cnPayload!.verifyUrl, /\/verify\/credit-notes\//);
    assert.match(rdPayload!.verifyUrl, /\/verify\/refund-documents\//);
    assert.equal(cnPayload!.verifyUrl.includes("/public/"), false);
  });

  it("public Phase B HTML still works with QR-enabled templates", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const link = await issueInvoicePublicLink(invoice.id);
    const res = await handlePublicInvoiceView(
      decodeURIComponent(link!.url.split("/").pop()!),
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(invoice.invoiceNumber));
    assert.match(html, /data-section="verification_qr"/);

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    assert.equal(after.status, "generated");
    const events = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    assert.equal(events, 0);
  });

  it("buildVerifyUrl encodes document id and signature", () => {
    const url = buildVerifyUrl("abc123", "invoice");
    assert.match(url, /\/verify\/invoices\/abc123\//);
    const sig = url.split("/").pop()!;
    assert.equal(sig.length, 22);
  });
});
