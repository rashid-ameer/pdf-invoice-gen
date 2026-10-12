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
  getInvoiceDetailsForShop,
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
    assert.match(source, /gridTemplateColumns="1fr auto"/);
    assert.match(source, /s-popover/);
    assert.match(source, /s-date-picker/);
    assert.match(source, /s-clickable-chip/);
    assert.match(source, /filter-active|"filter"/);
    assert.match(source, /Search by invoice, order, customer, email/);
    assert.doesNotMatch(source, /FILTER_GRID_COLS/);
    assert.doesNotMatch(source, /s-query-container/);
    assert.doesNotMatch(source, /s-date-field/);
    assert.doesNotMatch(source, /icon="sort"|commandFor=.*sort/);
    assert.match(source, /gridTemplateColumns="auto 1fr"/);
    assert.match(source, /clickDelegate=\{linkId\}/);
    assert.match(source, /detailsHref/);
    assert.match(source, /navigate\(`\/app\/invoices\/\$\{encodeURIComponent\(id\)\}`\)/);
    assert.doesNotMatch(
      source,
      /href=\{`\/app\/invoices\/\$\{encodeURIComponent\(invoice\.id\)\}\/view`\}/,
    );
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
    assert.match(source, /InvoicePrintPreviewModal/);
    assert.match(source, /INVOICE_PRINT_PREVIEW_MODAL_ID/);
    assert.match(
      source,
      /InvoicePrintPreviewModal[\s\S]*id=\{INVOICE_PRINT_PREVIEW_MODAL_ID\}/,
    );
    assert.match(source, /modal\.show\(INVOICE_PRINT_PREVIEW_MODAL_ID\)/);
    assert.match(source, /fetchInvoiceDocumentsHtml/);
    assert.match(source, /openPrintPreview/);
    assert.doesNotMatch(source, /fetchAndPrintInvoiceDocument/);
    assert.match(source, /Send email/);
    assert.match(source, /const sendEmail = /);
    assert.match(source, /openSendEmailModal/);
    assert.match(source, /SendDocumentEmailModal/);
    assert.match(source, /sendInvoiceEmail/);
    assert.match(source, /trigger: "manual"/);
    assert.match(source, /Generate customer link/);
    assert.match(source, /openCustomerLinkModal/);
    assert.match(source, /generateCustomerLink/);
    assert.match(source, /CustomerLinkCopyModal/);
    assert.match(source, /intent === "customer-link"/);
    assert.match(source, /issueInvoicePublicLinkForShop/);
    assert.doesNotMatch(source, /Copy customer link/);
    assert.doesNotMatch(source, /\bDocumentEmailModal\b|s-email-field/);
    assert.doesNotMatch(source, /icon="email"\s+disabled/);
    assert.match(source, /isInvoicesListPath/);
    assert.match(source, /navigation\.location/);
    assert.doesNotMatch(
      source,
      /const loading = navigation\.state === "loading";/,
    );
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
    assert.match(source, /downloadCsvExport/);
    assert.match(source, /\/app\/invoices\/export\/csv/);
    assert.doesNotMatch(
      source,
      /href="\/app\/invoices\/export\/csv"/,
    );
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
    assert.doesNotMatch(source, /Clear search and filters/);
    assert.match(source, /Clear all/);
    assert.doesNotMatch(source, /Clear filters/);
    assert.match(source, /type="search"/);
    assert.match(source, /<s-empty-state heading="No invoices yet"/);
    assert.match(
      source,
      /Invoices are created from your orders\. Sync your orders to start\s+generating invoices\./,
    );
    // First-time empty state has no Sync button — page header already has it
    assert.doesNotMatch(
      source,
      /heading="No invoices yet"[\s\S]*?slot="primary-action"[\s\S]*?Sync orders/,
    );
    assert.match(source, /slot="primary-action"[\s\S]*?>\s*Sync orders\s*</);
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

describe("HTML view + template picker + bulk", () => {
  it("renders HTML viewer markup with download link (QR when template enables it)", async () => {
    const { store, invoice } = await seedInvoice();
    const templates = await listTaxInvoiceTemplatesForShop(store.shopifyDomain);
    assert.ok(templates && templates.length > 0);

    const doc = await renderInvoiceDocument(
      store.shopifyDomain,
      invoice.id,
      templates![0].id,
    );
    assert.ok(doc);
    // Group 13 Phase C: tax_invoice QR when template qrCode.visible (system default on).
    assert.match(doc!.html, /data-section="verification_qr"|verification-qr/);
    assert.match(doc!.html, /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/);

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

describe("Invoice details page", () => {
  it("wires Polaris details shell to G5/G7 embed preview routes", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices_.$id.tsx"),
      "utf8",
    );
    assert.match(source, /getInvoiceDetailsForShop/);
    assert.match(source, /slot="breadcrumb-actions"/);
    assert.match(source, /href="\/app\/invoices"/);
    assert.doesNotMatch(source, /slot="accessory"/);
    assert.match(source, /slot="primary-action"/);
    assert.match(source, />\s*Send email\s*</);
    assert.match(source, /sendInvoiceEmail/);
    assert.match(source, /trigger: "manual"/);
    assert.match(source, /const sendEmail = /);
    assert.match(source, /icon="email"/);
    assert.doesNotMatch(source, /Send email is not available yet/);
    assert.doesNotMatch(source, /DocumentEmailModal|s-modal|s-email-field/);
    assert.match(source, /commandFor=\{MORE_MENU_ID\}/);
    assert.match(source, /icon="link"/);
    assert.match(source, /icon="print"/);
    assert.match(source, /icon="download"/);
    assert.match(source, /Generate customer link/);
    assert.match(source, /openCustomerLinkModal/);
    assert.match(source, /generateCustomerLink/);
    assert.match(source, /CustomerLinkCopyModal/);
    assert.match(source, /intent === "customer-link"/);
    assert.match(source, /issueInvoicePublicLinkForShop/);
    assert.doesNotMatch(source, /Copy customer link/);
    assert.doesNotMatch(source, /const copyCustomerLink = /);
    assert.match(source, />\s*More actions\s*</);
    assert.equal(
      [...source.matchAll(/slot="secondary-actions"/g)].length,
      1,
      "Print/Download should only live under More actions",
    );
    assert.match(source, /DETAIL_LAYOUT_COLS/);
    assert.match(source, /position: "sticky"/);
    assert.match(source, /heading="Summary"/);
    assert.match(source, /Customer/);
    assert.match(source, /Order/);
    assert.match(source, /Invoice date/);
    assert.match(source, /Payment status/);
    assert.match(source, /paymentStatusBadgeTone/);
    assert.match(source, /Total/);
    assert.doesNotMatch(source, /heading="Customer"/);
    assert.doesNotMatch(source, /heading="Order"/);
    assert.doesNotMatch(source, /heading="Details"/);
    assert.match(source, /isInvoiceDetailsPath/);
    assert.match(source, /loadingDetailsContent/);
    assert.match(source, /shopify\.loading/);
    assert.match(source, /navigation\.location/);
    assert.doesNotMatch(
      source,
      /const invoiceLoading = navigation\.state === "loading"/,
    );
    assert.match(source, /previewHtml/);
    assert.match(source, /srcDoc=\{previewHtml\}/);
    assert.match(source, /wrapA4EmbedHtml/);
    assert.match(source, /renderInvoiceDocument/);
    assert.match(source, /<iframe/);
    assert.match(source, /Invoice not found/);
    assert.match(source, /Back to Invoices/);
    assert.doesNotMatch(source, /inlineSize="large"/);
    assert.doesNotMatch(source, /packing.?slip|credit.?note|QR code|public link/i);

    const docSource = readFileSync(
      join(process.cwd(), "app/models/invoice-document.server.ts"),
      "utf8",
    );
    assert.match(docSource, /getInvoiceDetailsForShop/);
    assert.match(docSource, /view\?embed=1/);
  });

  it("loads details metadata and reuses the same document URLs as list actions", async () => {
    const { store, invoice } = await seedInvoice({
      financialStatus: "paid",
      invoiceNumber: "INV-DETAILS-1",
    });
    const details = await getInvoiceDetailsForShop(
      store.shopifyDomain,
      invoice.id,
    );
    assert.ok(details);
    assert.equal(details!.invoiceNumber, "INV-DETAILS-1");
    assert.equal(details!.buyerName, "UI Buyer");
    assert.equal(details!.shopifyOrderNumber, "#UI-1");
    assert.equal(details!.status, "generated");
    assert.equal(details!.financialStatus, "paid");
    assert.equal(details!.grandTotal, 10.5);
    assert.equal(details!.currency, "AED");
    assert.equal(
      details!.previewEmbedUrl,
      `/app/invoices/${encodeURIComponent(invoice.id)}/view?embed=1`,
    );
    assert.equal(
      details!.printUrl,
      `/app/invoices/${encodeURIComponent(invoice.id)}/download?mode=print`,
    );
    assert.equal(
      details!.downloadUrl,
      `/app/invoices/${encodeURIComponent(invoice.id)}/download`,
    );
    assert.match(details!.orderAdminUrl ?? "", /admin\.shopify\.com\/store\//);
    assert.match(details!.orderAdminUrl ?? "", /\/orders\//);

    assert.equal(
      await getInvoiceDetailsForShop(store.shopifyDomain, "missing-id"),
      null,
    );
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
