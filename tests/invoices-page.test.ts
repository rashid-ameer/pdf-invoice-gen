import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
} from "../app/models/document-preview.server";
import {
  listTaxInvoiceTemplatesForShop,
  recordInvoiceDownload,
  renderInvoiceDocument,
  renderInvoicesBulk,
} from "../app/models/invoice-document.server";
import {
  exportAllInvoicesForShop,
  invoicesToCsv,
  listInvoicesForShop,
  parseInvoiceListQuery,
} from "../app/models/invoice-list.server";
import { enqueueSyncOrders } from "../app/models/sync-queue.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import { reregisterWebhooksForShop } from "../app/models/webhook-register.server";
import {
  csvDownloadResponse,
  htmlDocumentResponse,
  pdfDownloadResponse,
} from "../app/utils/document-response.server";
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

async function seedInvoice(opts?: {
  financialStatus?: string;
  invoiceNumber?: string;
}) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `ui-${randomUUID()}.myshopify.com`,
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
      shopifyOrderNumber: "#UI-1",
      invoiceNumber: opts?.invoiceNumber ?? `INV-UI-${randomUUID().slice(0, 6)}`,
      status: "generated",
      financialStatus: opts?.financialStatus ?? "paid",
      issueDate: new Date("2024-06-15T10:00:00Z"),
      currency: "AED",
      seller: { legalName: "Seller", address: { city: "Dubai", country: "AE" } },
      buyer: {
        name: "UI Buyer",
        email: "ui-buyer@example.com",
        phone: "+971500000001",
      },
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
        amountDue: 10.5,
      },
    },
  });
  return { merchant, store, invoice };
}

describe("Invoices page wiring", () => {
  it("registers Invoices in app navigation", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.tsx"),
      "utf8",
    );
    assert.match(source, /href="\/app\/invoices"/);
    assert.match(source, />Invoices</);
  });

  it("renders an Index Table UI with required columns and no later-group features", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.match(source, /inlineSize="large"/);
    assert.match(source, /<s-table/);
    assert.doesNotMatch(source, /variant=\{tableVariant\}|variant="list"/);
    assert.doesNotMatch(source, /matchMedia\(/);
    assert.match(source, /listSlot="primary"/);
    assert.match(source, /listSlot="labeled">Order</);
    assert.match(source, /listSlot="labeled">Payment status</);
    assert.match(source, /listSlot="labeled">Invoice status</);
    assert.match(source, /listSlot="labeled">Actions</);
    assert.doesNotMatch(source, /listSlot="secondary"/);
    assert.doesNotMatch(source, /listSlot="inline"/);
    assert.doesNotMatch(source, /listSlot="kicker"/);
    assert.match(source, /FILTER_GRID_COLS/);
    assert.match(source, /s-query-container/);
    assert.match(source, /gridTemplateColumns=\{FILTER_GRID_COLS\}/);
    assert.match(source, /gridTemplateColumns="auto 1fr"/);
    assert.match(source, /clickDelegate=\{checkboxId\}/);
    assert.match(source, />Invoice</);
    assert.match(source, />Order</);
    assert.match(source, />Customer</);
    assert.match(source, />Date</);
    assert.match(source, />\s*Total\s*</);
    assert.match(source, /Payment status/);
    assert.match(source, /Invoice status/);
    assert.match(source, />Actions</);
    assert.match(source, /<s-menu/);
    assert.match(source, /Print selected/);
    assert.match(source, /Send email/);
    assert.match(source, /disabled/);
    assert.doesNotMatch(source, /packing.?slip|credit.?note|QR code|public link/i);
    assert.doesNotMatch(source, /white-space:\s*nowrap|@media/);
  });

  it("exposes Sync, Export CSV, and Re-register webhooks as page actions", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.match(source, /slot="primary-action"/);
    assert.match(source, /slot="secondary-actions"/);
    assert.match(source, />\s*Sync orders\s*</);
    assert.match(source, />\s*Export CSV\s*</);
    assert.match(source, />\s*Re-register webhooks\s*</);
    assert.match(source, /href="\/app\/invoices\/export\/csv"/);
    assert.match(source, /enqueueSyncOrders/);
    assert.match(source, /reregisterWebhooksForShop/);
    assert.match(source, /intent", "reregister"/);
    assert.doesNotMatch(source, /\/webhooks\/shopify/);
  });

  it("implements filtered and first-time empty states with Polaris empty-state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.match(source, /<s-empty-state heading="No invoices found"/);
    assert.match(source, /Clear search and filters/);
    assert.match(source, /type="search"/);
    assert.match(source, /<s-empty-state heading="No invoices yet"/);
    assert.match(source, /Sync orders/);
    assert.match(source, /enqueueSyncOrders/);
    assert.match(source, /showEmptyContent = !loading/);
  });

  it("does not reintroduce /webhooks/shopify", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.doesNotMatch(source, /\/webhooks\/shopify/);
  });
});

describe("document responses", () => {
  it("builds CSV, HTML, and PDF responses with correct headers", async () => {
    const csv = csvDownloadResponse("a,b\r\n1,2\r\n", "invoices");
    assert.equal(csv.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.match(csv.headers.get("Content-Disposition") ?? "", /invoices-.*\.csv/);

    const html = htmlDocumentResponse("<html></html>");
    assert.equal(html.headers.get("Content-Type"), "text/html; charset=utf-8");

    const pdf = pdfDownloadResponse(Buffer.from("%PDF-1.4"), "INV-1-Modern");
    assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
    assert.match(pdf.headers.get("Content-Disposition") ?? "", /INV-1-Modern\.pdf/);
  });
});

describe("page filter/query integration", () => {
  it("supports search, payment status, date range, pagination, and reset semantics", async () => {
    const a = await seedInvoice({
      financialStatus: "paid",
      invoiceNumber: "INV-PAGE-PAID",
    });
    await prisma.invoice.create({
      data: {
        merchantId: a.merchant.id,
        storeId: a.store.id,
        legalEntityId: a.merchant.id,
        shopifyOrderId: "pending-1",
        shopifyOrderNumber: "#P2",
        invoiceNumber: "INV-PAGE-PEND",
        status: "generated",
        financialStatus: "pending",
        issueDate: new Date("2024-01-10T10:00:00Z"),
        currency: "AED",
        seller: a.invoice.seller as object,
        buyer: {
          name: "Other",
          email: "other@example.com",
        },
        lineItems: a.invoice.lineItems as object,
        totals: a.invoice.totals as object,
      },
    });

    const searched = await listInvoicesForShop(
      a.store.shopifyDomain,
      parseInvoiceListQuery({ q: "INV-PAGE-PAID" }),
    );
    assert.equal(searched!.total, 1);

    const paid = await listInvoicesForShop(
      a.store.shopifyDomain,
      parseInvoiceListQuery({ paymentStatus: "paid" }),
    );
    assert.equal(paid!.total, 1);

    const ranged = await listInvoicesForShop(
      a.store.shopifyDomain,
      parseInvoiceListQuery({ from: "2024-06-01", to: "2024-06-30" }),
    );
    assert.equal(ranged!.total, 1);

    const page = await listInvoicesForShop(
      a.store.shopifyDomain,
      parseInvoiceListQuery({ page: "1", limit: "10" }),
    );
    assert.equal(page!.items.length, 2);
    assert.equal(page!.pages, 1);
    assert.equal(page!.limit, 10);

    const reset = await listInvoicesForShop(
      a.store.shopifyDomain,
      parseInvoiceListQuery({}),
    );
    assert.equal(reset!.total, 2);
    assert.equal(reset!.hasFilters, false);
  });

  it("CSV export ignores UI filters and uses response helper", async () => {
    const { store } = await seedInvoice({ financialStatus: "paid" });
    await prisma.invoice.create({
      data: {
        merchantId: store.merchantId,
        storeId: store.id,
        legalEntityId: store.merchantId,
        shopifyOrderId: "csv-u2",
        shopifyOrderNumber: "#C2",
        invoiceNumber: "INV-CSV-UI-2",
        status: "generated",
        financialStatus: "pending",
        issueDate: new Date("2023-01-01T00:00:00Z"),
        currency: "AED",
        seller: { legalName: "S" },
        buyer: { name: "B", email: "b@example.com" },
        lineItems: [],
        totals: { grandTotal: 1 },
      },
    });

    const filtered = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
      paymentStatus: "paid",
    });
    assert.equal(filtered!.total, 1);

    const exported = await exportAllInvoicesForShop(store.shopifyDomain);
    assert.equal(exported!.items.length, 2);
    const response = csvDownloadResponse(invoicesToCsv(exported!.items));
    const body = await response.text();
    assert.match(body, /INV-CSV-UI-2/);
    assert.match(body, /Paid|Pending/);
  });
});

describe("sync and webhook page actions (Group 8 reuse)", () => {
  it("enqueueSyncOrders returns background mode for an active store", async () => {
    const { store } = await seedInvoice();
    assert.equal(await enqueueSyncOrders(store.shopifyDomain), "background");
  });

  it("reregisterWebhooksForShop maps missing token to needsReauth", async () => {
    const result = await reregisterWebhooksForShop("any.myshopify.com", {
      getAdminSession: async () => ({ session: { accessToken: null } }),
      registerWebhooks: async () => ({}),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.needsReauth, true);
  });
});

describe("HTML view + template picker + bulk (no QR)", () => {
  it("renders HTML viewer markup with download link and no QR payload", async () => {
    const { store, invoice } = await seedInvoice();
    const templates = await listTaxInvoiceTemplatesForShop(store.shopifyDomain);
    assert.ok(templates && templates.length > 0);

    const doc = await renderInvoiceDocument(
      store.shopifyDomain,
      invoice.id,
      templates![0].id,
    );
    assert.ok(doc);
    assert.equal((doc as { verification?: unknown }).verification, undefined);
    assert.doesNotMatch(
      doc!.html,
      /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/,
    );

    const viewer = wrapA4DocumentViewerHtml(applyA4DocumentLayout(doc!.html), {
      title: `Invoice ${doc!.invoiceNumber}`,
      subtitle: `Template: ${doc!.templateName} · A4`,
      downloadUrl: `/app/invoices/${invoice.id}/download?templateId=${doc!.templateId}`,
    });
    assert.match(viewer, /Download|Print|Invoice/i);
    assert.match(viewer, /\/app\/invoices\/.*\/download/);
    const response = htmlDocumentResponse(viewer);
    assert.equal(response.status, 200);
  });

  it("bulk render skips missing ids and records download status", async () => {
    const { store, invoice } = await seedInvoice();
    const bulk = await renderInvoicesBulk(store.shopifyDomain, [
      invoice.id,
      "missing",
    ]);
    assert.ok(bulk);
    assert.equal(bulk!.count, 1);

    await recordInvoiceDownload(
      store.shopifyDomain,
      invoice.id,
      bulk!.templateId,
      bulk!.templateName,
    );
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(updated!.status, "downloaded");
  });
});

describe("empty and error states", () => {
  it("returns empty list for shop with no invoices", async () => {
    const merchant = await prisma.merchant.create({
      data: { name: `empty-${randomUUID()}`, billingStatus: "active" },
    });
    const store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        shopifyDomain: `empty-${randomUUID()}.myshopify.com`,
        accessToken: encryptSecret("tok")!,
        status: "active",
        currency: "AED",
      },
    });
    cleanup.push({ merchantId: merchant.id, storeId: store.id });
    const list = await listInvoicesForShop(store.shopifyDomain);
    assert.equal(list!.total, 0);
    assert.equal(list!.items.length, 0);
  });

  it("returns null document for missing invoice (404 path)", async () => {
    const { store } = await seedInvoice();
    assert.equal(
      await renderInvoiceDocument(store.shopifyDomain, "no-such-invoice"),
      null,
    );
  });
});
