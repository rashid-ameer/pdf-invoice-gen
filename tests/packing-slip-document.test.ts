import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  invoiceToRenderData,
  getPackingSlipDetailsForShop,
  recordPackingSlipDownload,
  renderPackingSlipDocument,
  renderPackingSlipDocumentPdf,
  renderPackingSlipsBulk,
  BULK_INVOICE_LIMIT,
} from "../app/models/invoice-document.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import { pdfDownloadResponse } from "../app/utils/document-response.server";
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

async function seedStoreWithInvoice(opts?: {
  shopifyOrderNumber?: string | null;
  shippingLine1?: string;
}) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `ps-doc-${randomUUID()}.myshopify.com`,
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
      shopifyOrderNumber:
        opts?.shopifyOrderNumber === null
          ? null
          : (opts?.shopifyOrderNumber ?? "#PS-9001"),
      invoiceNumber: `INV-PS-${randomUUID().slice(0, 8)}`,
      status: "generated",
      financialStatus: "paid",
      shippingMethod: "Express",
      issueDate: new Date("2024-06-15T10:00:00Z"),
      currency: "AED",
      seller: {
        legalName: "Acme LLC",
        trn: "100000000000003",
        address: {
          line1: "Street",
          city: "Dubai",
          emirate: "Dubai",
          country: "AE",
        },
      },
      buyer: {
        name: "Buyer Co",
        email: "buyer@example.com",
        address: { line1: "Buyer Road", city: "Abu Dhabi", country: "AE" },
      },
      shippingAddress: {
        line1: opts?.shippingLine1 ?? "Warehouse Dock 3",
        city: "Dubai",
        country: "AE",
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
      mode: "standard",
    },
  });

  return { merchant, store, invoice };
}

describe("packing slip render data", () => {
  it("prefers shipping address for packing_slip Ship To", async () => {
    const { invoice } = await seedStoreWithInvoice({
      shippingLine1: "Warehouse Dock 3",
    });
    const packing = invoiceToRenderData(invoice, "packing_slip");
    const tax = invoiceToRenderData(invoice, "tax_invoice");
    assert.match(packing.buyer.addressLine ?? "", /Warehouse Dock 3/);
    assert.match(tax.buyer.addressLine ?? "", /Buyer Road/);
  });
});

describe("renderPackingSlipDocument", () => {
  it("resolves packing_slip template and omits prices/VAT/totals", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    const doc = await renderPackingSlipDocument(store.shopifyDomain, invoice.id);
    assert.ok(doc);
    assert.equal(doc!.documentType, "packing_slip");
    assert.match(doc!.templateCode, /packing-slip/i);
    assert.match(doc!.html, /PACKING SLIP/i);
    assert.match(doc!.html, /Warehouse Dock 3/);
    assert.match(doc!.html, /SKU-1|Widget/i);
    assert.doesNotMatch(doc!.html, /Grand Total|Total due|VAT Total|105\.00/i);
    assert.doesNotMatch(doc!.html, /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/);
    assert.equal(doc!.orderNumber, "#PS-9001");
  });

  it("returns null for missing invoice or wrong shop", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    assert.equal(
      await renderPackingSlipDocument(store.shopifyDomain, "missing-id"),
      null,
    );
    assert.equal(
      await renderPackingSlipDocument("other.myshopify.com", invoice.id),
      null,
    );
  });
});

describe("recordPackingSlipDownload", () => {
  it("writes packing_slip_downloaded without flipping invoice.status", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    assert.equal(invoice.status, "generated");
    await recordPackingSlipDownload(
      store.shopifyDomain,
      invoice.id,
      "tpl-ps",
      "Packing Slip",
    );
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(updated!.status, "generated");
    const events = await prisma.invoiceStatusEvent.findMany({
      where: { invoiceId: invoice.id, status: "packing_slip_downloaded" },
    });
    assert.equal(events.length, 1);
    const meta = events[0]!.metadata as {
      documentType?: string;
      templateName?: string;
    } | null;
    assert.equal(meta?.documentType, "packing_slip");
    assert.equal(meta?.templateName, "Packing Slip");
  });
});

describe("packing slip PDF filename", () => {
  it("uses packing-slip-{orderNumber} and falls back to invoice number", async () => {
    const withOrder = await seedStoreWithInvoice({
      shopifyOrderNumber: "#ORD-42",
    });
    const withOrderDoc = await renderPackingSlipDocument(
      withOrder.store.shopifyDomain,
      withOrder.invoice.id,
    );
    assert.ok(withOrderDoc);
    const named = pdfDownloadResponse(
      Buffer.from("%PDF"),
      `packing-slip-${withOrderDoc!.orderNumber}`,
    );
    assert.match(
      named.headers.get("Content-Disposition") ?? "",
      /filename="packing-slip-_ORD-42\.pdf"/,
    );

    const noOrder = await seedStoreWithInvoice({ shopifyOrderNumber: null });
    const noOrderDoc = await renderPackingSlipDocument(
      noOrder.store.shopifyDomain,
      noOrder.invoice.id,
    );
    assert.ok(noOrderDoc);
    assert.equal(noOrderDoc!.orderNumber, noOrder.invoice.invoiceNumber);
    const fallback = pdfDownloadResponse(
      Buffer.from("%PDF"),
      `packing-slip-${noOrderDoc!.orderNumber}`,
    );
    assert.match(
      fallback.headers.get("Content-Disposition") ?? "",
      new RegExp(
        `filename="packing-slip-${noOrder.invoice.invoiceNumber.replace(/[^\w.\-]+/g, "_")}\\.pdf"`,
      ),
    );
  });

  it("returns null PDF for missing invoice", async () => {
    const { store } = await seedStoreWithInvoice();
    assert.equal(
      await renderPackingSlipDocumentPdf(store.shopifyDomain, "missing-id"),
      null,
    );
  });
});

describe("renderPackingSlipsBulk", () => {
  it("merges packing slips for print and skips missing ids", async () => {
    const a = await seedStoreWithInvoice({ shopifyOrderNumber: "#B1" });
    const b = await prisma.invoice.create({
      data: {
        merchantId: a.merchant.id,
        storeId: a.store.id,
        legalEntityId: a.merchant.id,
        shopifyOrderId: String(Math.floor(Math.random() * 1e9)),
        shopifyOrderNumber: "#B2",
        invoiceNumber: `INV-PS-B-${randomUUID().slice(0, 6)}`,
        status: "generated",
        financialStatus: "paid",
        issueDate: new Date("2024-06-16T10:00:00Z"),
        currency: "AED",
        seller: { legalName: "Acme LLC" },
        buyer: { name: "Buyer 2", email: "b2@example.com" },
        shippingAddress: { line1: "Dock 2", city: "Dubai", country: "AE" },
        lineItems: [
          {
            description: "Item",
            quantity: 1,
            unitPrice: 10,
            discount: 0,
            vatRate: 5,
            vatAmount: 0.5,
            lineTotal: 10.5,
          },
        ],
        totals: {
          subtotal: 10,
          discount: 0,
          vatTotal: 0.5,
          shipping: 0,
          grandTotal: 10.5,
        },
        mode: "standard",
      },
    });

    const bulk = await renderPackingSlipsBulk(a.store.shopifyDomain, [
      a.invoice.id,
      "missing-id",
      b.id,
    ]);
    assert.ok(bulk);
    assert.equal(bulk!.count, 2);
    assert.match(bulk!.html, /doc-page/);
    assert.match(bulk!.html, /PACKING SLIP/i);
    assert.doesNotMatch(bulk!.html, /Grand Total|Total due/i);
    assert.equal(BULK_INVOICE_LIMIT, 50);
  });

  it("bulk route is preview/print HTML only (no download recording)", () => {
    const src = readFileSync(
      join(process.cwd(), "app/routes/app.packing-slips_.bulk.tsx"),
      "utf8",
    );
    assert.match(src, /renderPackingSlipsBulk/);
    assert.match(src, /mode=preview/);
    assert.match(src, /Select at least one order/);
    assert.match(src, /You can print up to 50 packing slips at once/);
    assert.doesNotMatch(src, /recordPackingSlipDownload/);
    assert.doesNotMatch(src, /pdfDownloadResponse|mode === "download"/);
  });
});

describe("packing slip routes wiring", () => {
  it("view route does not record download; download route records", () => {
    const viewSrc = readFileSync(
      join(
        process.cwd(),
        "app/routes/app.invoices_.$id.packing-slip.view.tsx",
      ),
      "utf8",
    );
    assert.match(viewSrc, /renderPackingSlipDocument/);
    assert.match(viewSrc, /Packing slip not found/);
    assert.match(viewSrc, /embed=1/);
    assert.doesNotMatch(viewSrc, /recordPackingSlipDownload/);

    const downloadSrc = readFileSync(
      join(process.cwd(), "app/routes/app.invoices_.$id.packing-slip.tsx"),
      "utf8",
    );
    assert.match(downloadSrc, /renderPackingSlipDocumentPdf/);
    assert.match(downloadSrc, /recordPackingSlipDownload/);
    assert.match(downloadSrc, /packing-slip-\$/);
    assert.doesNotMatch(downloadSrc, /status:\s*"downloaded"/);
  });

  it("packing slips page Actions menu is View / Print / Download only", () => {
    const src = readFileSync(
      join(process.cwd(), "app/routes/app.packing-slips.tsx"),
      "utf8",
    );
    assert.match(src, /\/app\/packing-slips\/\$\{/);
    assert.match(src, /fetchAndPrintPackingSlipDocument/);
    assert.match(src, /fetchAndPrintPackingSlipDocuments/);
    assert.match(src, /downloadPackingSlipPdf/);
    assert.match(src, />\s*View\s*</);
    assert.match(src, />\s*Print\s*</);
    assert.match(src, />\s*Download\s*</);
    assert.match(src, /Print selected/);
    assert.doesNotMatch(src, /Download selected/);
    assert.doesNotMatch(src, />\s*Copy\s*</);
    assert.doesNotMatch(src, />\s*Send email\s*</);
    assert.doesNotMatch(src, /templateId|template picker/i);
  });
});

describe("packing slip details page", () => {
  it("wires Polaris details shell with Print/Download and packing-slip preview", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.packing-slips_.$id.tsx"),
      "utf8",
    );
    assert.match(source, /getPackingSlipDetailsForShop/);
    assert.match(source, /renderPackingSlipDocument/);
    assert.match(source, /wrapA4EmbedHtml/);
    assert.match(source, /slot="breadcrumb-actions"/);
    assert.match(source, /href="\/app\/packing-slips"/);
    assert.match(source, /slot="accessory"/);
    assert.match(source, /paymentStatusBadgeTone/);
    assert.match(source, /invoiceStatusBadgeTone/);
    assert.match(source, /slot="primary-action"/);
    assert.match(source, /slot="secondary-actions"/);
    assert.match(source, />\s*Print\s*</);
    assert.match(source, />\s*Download\s*</);
    assert.match(source, /printInvoiceHtml/);
    assert.match(source, /downloadPackingSlipPdf/);
    assert.match(source, /heading="Packing slip"/);
    assert.match(source, /heading="Summary"/);
    assert.match(source, /Customer/);
    assert.match(source, /Order/);
    assert.match(source, /Payment status/);
    assert.match(source, /Invoice date/);
    assert.match(source, /Total/);
    assert.doesNotMatch(source, /heading="Customer"/);
    assert.doesNotMatch(source, /heading="Order"/);
    assert.doesNotMatch(source, /heading="Details"/);
    assert.match(source, /srcDoc=\{previewHtml\}/);
    assert.match(source, /Packing slip not found/);
    assert.match(source, /Back to Packing slips/);
    assert.match(source, /isPackingSlipDetailsPath/);
    assert.match(source, /shopify\.loading/);
    assert.doesNotMatch(source, />\s*Send email\s*</);
    assert.doesNotMatch(source, />\s*Copy\s*</);
    assert.doesNotMatch(source, /More actions/);
    assert.doesNotMatch(source, /template picker|QR code|public link/i);
    assert.doesNotMatch(source, /inlineSize="large"/);
  });

  it("loads packing-slip details metadata with packing document URLs", async () => {
    const { store, invoice } = await seedStoreWithInvoice({
      shopifyOrderNumber: "#PS-DET-1",
    });
    const details = await getPackingSlipDetailsForShop(
      store.shopifyDomain,
      invoice.id,
    );
    assert.ok(details);
    assert.equal(details!.invoiceNumber, invoice.invoiceNumber);
    assert.equal(details!.shopifyOrderNumber, "#PS-DET-1");
    assert.equal(details!.buyerName, "Buyer Co");
    assert.equal(
      details!.previewEmbedUrl,
      `/app/invoices/${encodeURIComponent(invoice.id)}/packing-slip/view?embed=1`,
    );
    assert.equal(
      details!.downloadUrl,
      `/app/invoices/${encodeURIComponent(invoice.id)}/packing-slip`,
    );
    assert.match(details!.orderAdminUrl ?? "", /admin\.shopify\.com\/store\//);

    assert.equal(
      await getPackingSlipDetailsForShop(store.shopifyDomain, "missing-id"),
      null,
    );
  });
});
