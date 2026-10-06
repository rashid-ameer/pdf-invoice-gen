import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  invoiceToRenderData,
  listTaxInvoiceTemplatesForShop,
  recordInvoiceDownload,
  renderInvoiceDocument,
  renderInvoiceDocumentPdf,
  renderInvoicesBulk,
  renderInvoicesBulkPdf,
  BULK_INVOICE_LIMIT,
} from "../app/models/invoice-document.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

before(async () => {
  await ensureSystemTemplates();
});

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

async function seedStoreWithInvoice() {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `doc-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });

  const invoice = await prisma.invoice.create({
    data: {
      merchantId: merchant.id,
      storeId: store.id,
      legalEntityId: merchant.id,
      shopifyOrderId: String(Math.floor(Math.random() * 1e9)),
      shopifyOrderNumber: "#9001",
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      status: "generated",
      financialStatus: "paid",
      issueDate: new Date("2024-06-15T10:00:00Z"),
      currency: "AED",
      seller: {
        legalName: "Acme LLC",
        trn: "100000000000003",
        address: { line1: "Street", city: "Dubai", emirate: "Dubai", country: "AE" },
      },
      buyer: {
        name: "Buyer Co",
        email: "buyer@example.com",
        address: { line1: "Road", city: "Dubai", country: "AE" },
      },
      lineItems: [
        {
          description: "Widget — Blue",
          productTitle: "Widget",
          variantTitle: "Blue",
          quantity: 2,
          unitPrice: 50,
          discount: 0,
          vatRate: 5,
          vatAmount: 5,
          lineTotal: 105,
          sku: "SKU-1",
        },
      ],
      totals: {
        subtotal: 100,
        discount: 0,
        vatTotal: 5,
        shipping: 0,
        grandTotal: 105,
        amountDue: 105,
        totalWithoutTax: 100,
      },
      pint: {
        invoiceTypeCode: "380",
        dueDate: "2024-07-15T10:00:00.000Z",
      },
    },
  });

  return { merchant, store, invoice };
}

describe("invoiceToRenderData", () => {
  it("maps persisted invoice JSON into template render fields", async () => {
    const { invoice } = await seedStoreWithInvoice();
    const data = invoiceToRenderData(invoice);
    assert.equal(data.invoiceNumber, invoice.invoiceNumber);
    assert.equal(data.orderNumber, "#9001");
    assert.equal(data.seller.legalName, "Acme LLC");
    assert.equal(data.buyer.name, "Buyer Co");
    assert.equal(data.lineItems.length, 1);
    assert.equal(data.totals.grandTotal, "105.00");
    assert.equal((data as { verification?: unknown }).verification, undefined);
  });
});

describe("renderInvoiceDocument", () => {
  it("resolves a system template and renders HTML with verification QR when enabled", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    const doc = await renderInvoiceDocument(store.shopifyDomain, invoice.id);
    assert.ok(doc);
    assert.match(doc!.html, /Widget|Invoice|Acme/i);
    assert.match(doc!.html, /data-section="verification_qr"/);
    assert.match(doc!.html, /data:image\/png;base64,/);
    assert.ok(doc!.templateId);
    assert.equal(doc!.invoiceNumber, invoice.invoiceNumber);
  });

  it("returns null for missing invoice or wrong shop", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    assert.equal(
      await renderInvoiceDocument(store.shopifyDomain, "missing-id"),
      null,
    );
    assert.equal(
      await renderInvoiceDocument("other.myshopify.com", invoice.id),
      null,
    );
  });

  it("uses an explicit template id when provided", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    const templates = await listTaxInvoiceTemplatesForShop(store.shopifyDomain);
    assert.ok(templates && templates.length > 0);
    const chosen = templates!.find((t) => t.code === "modern") ?? templates![0];
    const doc = await renderInvoiceDocument(
      store.shopifyDomain,
      invoice.id,
      chosen.id,
    );
    assert.ok(doc);
    assert.equal(doc!.templateId, chosen.id);
  });
});

describe("recordInvoiceDownload", () => {
  it("sets status generated → downloaded and writes a status event", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    assert.equal(invoice.status, "generated");
    await recordInvoiceDownload(
      store.shopifyDomain,
      invoice.id,
      "tpl-1",
      "Modern",
    );
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(updated!.status, "downloaded");
    const events = await prisma.invoiceStatusEvent.findMany({
      where: { invoiceId: invoice.id, status: "downloaded" },
    });
    assert.equal(events.length, 1);

    // Second download does not flip status again but still logs an event.
    await recordInvoiceDownload(
      store.shopifyDomain,
      invoice.id,
      "tpl-1",
      "Modern",
    );
    const again = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(again!.status, "downloaded");
    const events2 = await prisma.invoiceStatusEvent.findMany({
      where: { invoiceId: invoice.id, status: "downloaded" },
    });
    assert.equal(events2.length, 2);
  });
});

describe("renderInvoicesBulk", () => {
  it("merges multiple invoices and skips missing ids", async () => {
    const a = await seedStoreWithInvoice();
    const b = await seedStoreWithInvoice();
    // Different stores — bulk is shop-scoped; use two invoices on same store.
    const second = await prisma.invoice.create({
      data: {
        merchantId: a.merchant.id,
        storeId: a.store.id,
        legalEntityId: a.merchant.id,
        shopifyOrderId: "bulk-2",
        shopifyOrderNumber: "#9002",
        invoiceNumber: `INV-BULK-${randomUUID().slice(0, 6)}`,
        status: "generated",
        issueDate: new Date(),
        currency: "AED",
        seller: a.invoice.seller as object,
        buyer: a.invoice.buyer as object,
        lineItems: a.invoice.lineItems as object,
        totals: a.invoice.totals as object,
      },
    });

    const bulk = await renderInvoicesBulk(a.store.shopifyDomain, [
      a.invoice.id,
      "missing",
      second.id,
    ]);
    assert.ok(bulk);
    assert.equal(bulk!.count, 2);
    assert.ok(bulk!.html.length > 100);
    assert.ok(BULK_INVOICE_LIMIT >= 2);

    // Cross-shop id must not leak into another shop's bulk.
    const leaked = await renderInvoicesBulk(a.store.shopifyDomain, [b.invoice.id]);
    assert.equal(leaked, null);
  });
});

function chromiumAvailable(): boolean {
  return Boolean(
    process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_PATH ||
      process.env.RUN_PDF_SMOKE === "1",
  );
}

describe("renderInvoiceDocumentPdf", () => {
  it("returns null for a missing invoice", async () => {
    const { store } = await seedStoreWithInvoice();
    assert.equal(
      await renderInvoiceDocumentPdf(store.shopifyDomain, "missing-id"),
      null,
    );
  });

  it(
    "generates a PDF buffer via Group 7 cache for a real invoice",
    { skip: !chromiumAvailable() },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      const result = await renderInvoiceDocumentPdf(
        store.shopifyDomain,
        invoice.id,
      );
      assert.ok(result);
      assert.ok(result!.pdf.length > 100);
      assert.equal(result!.pdf.subarray(0, 4).toString(), "%PDF");
      assert.equal(result!.doc.invoiceNumber, invoice.invoiceNumber);
    },
  );
});

describe("renderInvoicesBulkPdf", () => {
  it("returns null when no invoices resolve", async () => {
    const { store } = await seedStoreWithInvoice();
    assert.equal(
      await renderInvoicesBulkPdf(store.shopifyDomain, ["missing-a", "missing-b"]),
      null,
    );
  });

  it(
    "generates a merged PDF for multiple invoices",
    { skip: !chromiumAvailable() },
    async () => {
      const a = await seedStoreWithInvoice();
      const second = await prisma.invoice.create({
        data: {
          merchantId: a.merchant.id,
          storeId: a.store.id,
          legalEntityId: a.merchant.id,
          shopifyOrderId: "pdf-bulk-2",
          shopifyOrderNumber: "#9102",
          invoiceNumber: `INV-PDF-${randomUUID().slice(0, 6)}`,
          status: "generated",
          issueDate: new Date(),
          currency: "AED",
          seller: a.invoice.seller as object,
          buyer: a.invoice.buyer as object,
          lineItems: a.invoice.lineItems as object,
          totals: a.invoice.totals as object,
        },
      });
      const result = await renderInvoicesBulkPdf(a.store.shopifyDomain, [
        a.invoice.id,
        second.id,
      ]);
      assert.ok(result);
      assert.equal(result!.count, 2);
      assert.equal(result!.pdf.subarray(0, 4).toString(), "%PDF");
    },
  );
});

describe("listTaxInvoiceTemplatesForShop", () => {
  it("lists active tax_invoice templates for template picker", async () => {
    const { store } = await seedStoreWithInvoice();
    const templates = await listTaxInvoiceTemplatesForShop(store.shopifyDomain);
    assert.ok(templates);
    assert.ok(templates!.length >= 1);
    assert.ok(templates!.every((t) => t.id && t.name && t.code));
  });
});
