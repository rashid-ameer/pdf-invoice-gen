/**
 * Group 13 Phase B — public HTML/PDF document routes.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import prisma from "../app/db.server";
import {
  handlePublicCreditNoteDownload,
  handlePublicCreditNoteView,
  handlePublicInvoiceDownload,
  handlePublicInvoiceView,
  PUBLIC_LINK_INVALID_MESSAGE,
  publicCreditNotePdfBasename,
  publicInvoicePdfBasename,
} from "../app/models/public-document.server";
import {
  issueCreditNotePublicLink,
  issueInvoicePublicLink,
  LINK_TTL_MS,
} from "../app/models/public-link.server";
import { pdfFilename } from "../app/models/pdf-cache.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

const hasChromium = Boolean(
  process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.RUN_PDF_SMOKE === "1",
);

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

function tokenFromUrl(url: string): string {
  const parts = url.split("/");
  return decodeURIComponent(parts[parts.length - 1] || "");
}

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

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `pd-${randomUUID()}.myshopify.com`,
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
      shopifyOrderNumber: "#2001",
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      mode: "standard",
      status: "generated",
      issueDate: new Date(),
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
          unitPrice: 100,
          discount: 0,
          vatRate: 5,
          vatAmount: 5,
          lineTotal: 105,
        },
      ],
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
          unitPrice: 50,
          discount: 0,
          vatRate: 5,
          vatAmount: 2.5,
          lineTotal: 52.5,
        },
      ],
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

function assertNoAuthInRoute(filename: string) {
  const filePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "app",
    "routes",
    filename,
  );
  const src = readFileSync(filePath, "utf8");
  assert.equal(
    /from\s+["'].*shopify\.server["']/.test(src),
    false,
    `${filename} must not import shopify.server`,
  );
  assert.equal(
    /authenticate\.admin\s*\(/.test(src),
    false,
    `${filename} must not call authenticate.admin`,
  );
}

describe("Group 13 Phase B — public documents", () => {
  it("invoice/CN/refund public HTML returns 200 for valid tokens", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    const invRes = await handlePublicInvoiceView(tokenFromUrl(inv!.url));
    const cnRes = await handlePublicCreditNoteView(
      tokenFromUrl(cn!.url),
      "credit_note",
    );
    const rdRes = await handlePublicCreditNoteView(
      tokenFromUrl(rd!.url),
      "refund_document",
    );

    assert.equal(invRes.status, 200);
    assert.equal(cnRes.status, 200);
    assert.equal(rdRes.status, 200);
    assert.match(
      invRes.headers.get("Content-Type") ?? "",
      /text\/html/,
    );

    const invHtml = await invRes.text();
    assert.match(invHtml, new RegExp(invoice.invoiceNumber));
    assert.match(invHtml, /a4-preview-toolbar|Secure link/);
    assert.match(invHtml, /\/public\/invoices\/.*\/download/);

    const cnHtml = await cnRes.text();
    assert.match(cnHtml, new RegExp(creditNote.creditNoteNumber));
    assert.match(cnHtml, /Credit note/);

    const rdHtml = await rdRes.text();
    assert.match(rdHtml, /Refund/);
    assert.match(rdHtml, /\/public\/refund-documents\/.*\/download/);
  });

  it(
    "invoice/CN/refund public PDF returns 200 with correct type and filename",
    { skip: !hasChromium },
    async () => {
      const { merchant, store } = await seedStore();
      const invoice = await seedInvoice(store.id, merchant.id);
      const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

      const inv = await issueInvoicePublicLink(invoice.id);
      const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
      const rd = await issueCreditNotePublicLink(
        creditNote.id,
        "refund_document",
      );

      const invRes = await handlePublicInvoiceDownload(tokenFromUrl(inv!.url));
      const cnRes = await handlePublicCreditNoteDownload(
        tokenFromUrl(cn!.url),
        "credit_note",
      );
      const rdRes = await handlePublicCreditNoteDownload(
        tokenFromUrl(rd!.url),
        "refund_document",
      );

      assert.equal(invRes.status, 200);
      assert.equal(cnRes.status, 200);
      assert.equal(rdRes.status, 200);
      assert.equal(invRes.headers.get("Content-Type"), "application/pdf");
      assert.equal(cnRes.headers.get("Content-Type"), "application/pdf");
      assert.equal(rdRes.headers.get("Content-Type"), "application/pdf");

      const invDisp = invRes.headers.get("Content-Disposition") ?? "";
      assert.match(invDisp, new RegExp(invoice.invoiceNumber));
      assert.match(invDisp, /\.pdf/);

      const cnDisp = cnRes.headers.get("Content-Disposition") ?? "";
      assert.match(cnDisp, new RegExp(creditNote.creditNoteNumber));

      const rdDisp = rdRes.headers.get("Content-Disposition") ?? "";
      assert.match(rdDisp, /Refund-/);
      assert.match(rdDisp, new RegExp(creditNote.creditNoteNumber));
    },
  );

  it("expired, invalid, and unknown tokens return 404 with old message", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);

    const expired = signPayload({
      i: invoice.id,
      e: Date.now() - 1000,
      t: "inv",
    });
    const expiredRes = await handlePublicInvoiceView(expired);
    assert.equal(expiredRes.status, 404);
    assert.equal(await expiredRes.text(), PUBLIC_LINK_INVALID_MESSAGE);

    const bad = await handlePublicInvoiceView("not-a-valid-token");
    assert.equal(bad.status, 404);
    assert.equal(await bad.text(), PUBLIC_LINK_INVALID_MESSAGE);

    const unknown = await handlePublicInvoiceDownload("");
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), PUBLIC_LINK_INVALID_MESSAGE);
  });

  it("rejects cross-document-type token access", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    const invToken = tokenFromUrl(inv!.url);
    const cnToken = tokenFromUrl(cn!.url);
    const rdToken = tokenFromUrl(rd!.url);

    assert.equal(
      (await handlePublicCreditNoteView(invToken, "credit_note")).status,
      404,
    );
    assert.equal((await handlePublicInvoiceView(cnToken)).status, 404);
    assert.equal(
      (await handlePublicCreditNoteView(cnToken, "refund_document")).status,
      404,
    );
    assert.equal(
      (await handlePublicCreditNoteView(rdToken, "credit_note")).status,
      404,
    );
    assert.equal(
      (await handlePublicCreditNoteDownload(rdToken, "credit_note")).status,
      404,
    );
  });

  it("missing document returns 404", async () => {
    const ghost = signPayload({
      i: "missing-document-id",
      e: Date.now() + LINK_TTL_MS,
      t: "inv",
    });
    const res = await handlePublicInvoiceView(ghost);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), PUBLIC_LINK_INVALID_MESSAGE);
  });

  it("public PDF does not create status events or mark downloaded", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    const beforeInvEvents = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    const beforeCnEvents = await prisma.invoiceStatusEvent.count({
      where: { creditNoteId: creditNote.id },
    });

    if (hasChromium) {
      await handlePublicInvoiceDownload(tokenFromUrl(inv!.url));
      await handlePublicCreditNoteDownload(tokenFromUrl(cn!.url), "credit_note");
      await handlePublicCreditNoteDownload(
        tokenFromUrl(rd!.url),
        "refund_document",
      );
    } else {
      // HTML path still must not mutate status; PDF handlers skip Chromium.
      await handlePublicInvoiceView(tokenFromUrl(inv!.url));
      await handlePublicCreditNoteView(tokenFromUrl(cn!.url), "credit_note");
      await handlePublicCreditNoteView(tokenFromUrl(rd!.url), "refund_document");
    }

    const afterInv = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const afterCn = await prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNote.id },
    });
    assert.equal(afterInv.status, "generated");
    assert.equal(afterCn.status, "generated");

    const afterInvEvents = await prisma.invoiceStatusEvent.count({
      where: { invoiceId: invoice.id },
    });
    const afterCnEvents = await prisma.invoiceStatusEvent.count({
      where: { creditNoteId: creditNote.id },
    });
    assert.equal(afterInvEvents, beforeInvEvents);
    assert.equal(afterCnEvents, beforeCnEvents);
  });

  it("public rendering uses Group 7 A4 viewer and resolved template type", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const creditNote = await seedCreditNote(store.id, merchant.id, invoice.id);

    const inv = await issueInvoicePublicLink(invoice.id);
    const cn = await issueCreditNotePublicLink(creditNote.id, "credit_note");
    const rd = await issueCreditNotePublicLink(creditNote.id, "refund_document");

    const invHtml = await (
      await handlePublicInvoiceView(tokenFromUrl(inv!.url))
    ).text();
    assert.match(invHtml, /a4-preview/);
    assert.match(invHtml, /Print|Download/i);
    // Tax invoice labels from system templates / render data
    assert.match(invHtml, /Tax Invoice|Invoice/i);

    const cnHtml = await (
      await handlePublicCreditNoteView(tokenFromUrl(cn!.url), "credit_note")
    ).text();
    assert.match(cnHtml, /Credit/i);

    const rdHtml = await (
      await handlePublicCreditNoteView(tokenFromUrl(rd!.url), "refund_document")
    ).text();
    assert.match(rdHtml, /Refund/i);
  });

  it("filename helpers match old public PDF basename rules", () => {
    assert.equal(
      publicInvoicePdfBasename("INV-00001", "Modern Classic"),
      "INV-00001-Modern-Classic",
    );
    assert.equal(
      publicCreditNotePdfBasename("CN-00001", "Modern Classic", "credit_note"),
      "CN-00001-Modern-Classic",
    );
    assert.equal(
      publicCreditNotePdfBasename(
        "CN-00001",
        "Modern Classic",
        "refund_document",
      ),
      "Refund-CN-00001-Modern-Classic",
    );
    assert.equal(
      pdfFilename("INV-00001-Modern-Classic"),
      "INV-00001-Modern-Classic.pdf",
    );
  });

  it("render failure returns 500 without exposing internals", async () => {
    const { merchant, store } = await seedStore();
    const invoice = await seedInvoice(store.id, merchant.id);
    const issued = await issueInvoicePublicLink(invoice.id);
    const token = tokenFromUrl(issued!.url);

    // Active-store gate in G7 renderer → null doc → 500 (old parity).
    await prisma.store.update({
      where: { id: store.id },
      data: { status: "uninstalled" },
    });

    const res = await handlePublicInvoiceView(token);
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.match(body, /could not be rendered/i);
    assert.equal(body.includes("prisma"), false);
    assert.equal(body.includes("stack"), false);
    assert.equal(body.includes(store.id), false);
  });

  it("public route modules do not use Shopify admin authentication", () => {
    assertNoAuthInRoute("public.invoices_.$token.tsx");
    assertNoAuthInRoute("public.invoices_.$token.download.tsx");
    assertNoAuthInRoute("public.credit-notes_.$token.tsx");
    assertNoAuthInRoute("public.credit-notes_.$token.download.tsx");
    assertNoAuthInRoute("public.refund-documents_.$token.tsx");
    assertNoAuthInRoute("public.refund-documents_.$token.download.tsx");
  });
});
