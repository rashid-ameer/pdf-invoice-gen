import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  creditNotesToCsv,
  exportCreditNotesForShop,
  listCreditNotesForShop,
  parseCreditNoteListQuery,
  parseCreditNoteListTab,
} from "../app/models/credit-note-list.server";
import { createCreditNoteFromRefund } from "../app/models/credit-note.server";
import { encryptSecret } from "../app/utils/token-crypto";
import { csvFilename } from "../app/utils/csv";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
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
      shopifyDomain: `cn-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });

  const orderId = String(Math.floor(Math.random() * 1e9));
  const invoice = await prisma.invoice.create({
    data: {
      merchantId: merchant.id,
      storeId: store.id,
      legalEntityId: merchant.id,
      shopifyOrderId: orderId,
      shopifyOrderNumber: `#${orderId}`,
      invoiceNumber: `INV-${randomUUID().slice(0, 6)}`,
      status: "generated",
      financialStatus: "partially_refunded",
      issueDate: new Date("2024-06-01T10:00:00Z"),
      currency: "AED",
      seller: {
        legalName: "Seller",
        address: { city: "Dubai", country: "AE" },
      },
      buyer: {
        name: "CN Buyer",
        email: "cn-buyer@example.com",
      },
      lineItems: [
        {
          sku: "SKU-A",
          description: "Widget — Blue",
          quantity: 2,
          unitPrice: 100,
          discount: 0,
          vatRate: 5,
          vatAmount: 10,
          lineTotal: 210,
        },
      ],
      totals: {
        subtotal: 200,
        discount: 0,
        vatTotal: 10,
        shipping: 0,
        grandTotal: 210,
      },
    },
  });

  return { merchant, store, invoice, orderId };
}

describe("parseCreditNoteListQuery / tabs", () => {
  it("defaults to credit-notes tab and page size 10", () => {
    const q = parseCreditNoteListQuery({});
    assert.equal(q.tab, "credit-notes");
    assert.equal(q.page, 1);
    assert.equal(q.limit, 10);
    assert.equal(q.q, "");
    assert.equal(q.status, "");
    assert.equal(q.from, "");
    assert.equal(q.to, "");
    assert.equal(parseCreditNoteListTab("refund-documents"), "refund-documents");
    assert.equal(parseCreditNoteListTab("refund"), "refund-documents");
  });
});

describe("listCreditNotesForShop", () => {
  it("lists store-scoped notes newest first with invoice fields", async () => {
    const { store, invoice, orderId } = await seedStoreWithInvoice();
    await createCreditNoteFromRefund(store.shopifyDomain, {
      id: 101,
      order_id: Number(orderId),
      created_at: "2024-07-01T12:00:00Z",
      note: "Return A",
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "100",
          total_tax: "5",
          line_item: { sku: "SKU-A", title: "Widget", price: "100" },
        },
      ],
    });
    await createCreditNoteFromRefund(store.shopifyDomain, {
      id: 102,
      order_id: Number(orderId),
      created_at: "2024-08-01T12:00:00Z",
      note: "Return B",
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "100",
          total_tax: "5",
          line_item: { sku: "SKU-A", title: "Widget", price: "100" },
        },
      ],
    });

    const list = await listCreditNotesForShop(store.shopifyDomain, {
      page: 1,
      limit: 10,
      tab: "credit-notes",
    });
    assert.ok(list);
    assert.equal(list!.total, 2);
    assert.equal(list!.items[0].creditNoteNumber, "CN-00002");
    assert.equal(list!.items[0].originalInvoiceNumber, invoice.invoiceNumber);
    assert.equal(list!.items[0].financialStatus, "partially_refunded");
    assert.equal(list!.items[0].buyerName, "CN Buyer");

    const sameRowsRefundTab = await listCreditNotesForShop(store.shopifyDomain, {
      page: 1,
      limit: 10,
      tab: "refund-documents",
    });
    assert.equal(sameRowsRefundTab!.total, 2);
    assert.equal(sameRowsRefundTab!.items[0].id, list!.items[0].id);
  });

  it("paginates and isolates stores", async () => {
    const a = await seedStoreWithInvoice();
    const b = await seedStoreWithInvoice();
    await createCreditNoteFromRefund(a.store.shopifyDomain, {
      id: 1,
      order_id: Number(a.orderId),
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "10",
          total_tax: "0",
          line_item: { sku: "SKU-A", title: "Widget", price: "10" },
        },
      ],
    });
    await createCreditNoteFromRefund(b.store.shopifyDomain, {
      id: 2,
      order_id: Number(b.orderId),
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "10",
          total_tax: "0",
          line_item: { sku: "SKU-A", title: "Widget", price: "10" },
        },
      ],
    });

    const listA = await listCreditNotesForShop(a.store.shopifyDomain, {
      page: 1,
      limit: 10,
      tab: "credit-notes",
    });
    assert.equal(listA!.total, 1);
    assert.equal(listA!.items[0].shopifyOrderNumber, a.invoice.shopifyOrderNumber);

    for (let i = 0; i < 3; i++) {
      await createCreditNoteFromRefund(a.store.shopifyDomain, {
        id: 10 + i,
        order_id: Number(a.orderId),
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "10",
            total_tax: "0",
            line_item: { sku: "SKU-A", title: "Widget", price: "10" },
          },
        ],
      });
    }
    const page1 = await listCreditNotesForShop(a.store.shopifyDomain, {
      page: 1,
      limit: 2,
      tab: "credit-notes",
    });
    assert.equal(page1!.items.length, 2);
    assert.equal(page1!.pages, 2);
    assert.equal(page1!.total, 4);
  });
});

describe("creditNotesToCsv / export", () => {
  it("uses old column headers for both kinds and exports all rows", async () => {
    const { store, orderId } = await seedStoreWithInvoice();
    await createCreditNoteFromRefund(store.shopifyDomain, {
      id: 55,
      order_id: Number(orderId),
      note: "CSV reason",
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "100",
          total_tax: "5",
          line_item: { sku: "SKU-A", title: "Widget", price: "100" },
        },
      ],
    });

    const exported = await exportCreditNotesForShop(store.shopifyDomain);
    assert.ok(exported);
    assert.equal(exported!.items.length, 1);

    const cnCsv = creditNotesToCsv(exported!.items, "credit-notes");
    assert.match(cnCsv, /^Credit note,/);
    assert.match(cnCsv, /Original invoice/);
    assert.match(cnCsv, /Order payment status/);
    assert.match(cnCsv, /CSV reason/);
    assert.doesNotMatch(cnCsv, /^Reference,/);

    const rdCsv = creditNotesToCsv(exported!.items, "refund-documents");
    assert.match(rdCsv, /^Reference,/);
    assert.match(rdCsv, /Original invoice/);

    assert.match(csvFilename("credit-notes"), /^credit-notes-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.match(
      csvFilename("refund-documents"),
      /^refund-documents-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });
});

describe("Credit notes page UI wiring", () => {
  it("wires nav, sync, csv, table selection, and document actions", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(page, /enqueueSyncRefunds/);
    assert.match(page, /Sync refunds/);
    assert.match(page, /Export CSV/);
    assert.match(page, /\/app\/credit-notes\/export\/csv/);
    assert.match(page, /s-empty-state/);
    assert.match(page, /s-table/);
    assert.match(page, /Print selected/);
    assert.match(page, /downloadCreditNotePdf/);
    assert.match(page, /fetchAndPrintCreditNoteDocuments/);
    assert.match(page, /s-menu/);
    assert.match(page, /menu-horizontal/);
    assert.match(page, /formatIssueDate/);
    assert.match(page, /month: "short"/);
    assert.match(page, /s-clickable/);
    assert.match(page, /Document refunds/);
    assert.match(page, /Credit notes/);
    assert.match(page, /switchTab/);
    assert.match(page, /refund-documents/);
    assert.match(page, /background=\{activeTab === "credit-notes" \? "base"/);
    assert.match(page, /background=\{isRefundTab \? "base"/);
    assert.doesNotMatch(page, /s-button-group/);
    assert.doesNotMatch(page, /icon=\{.*\? "check"/);
    assert.match(page, /s-date-picker/);
    assert.match(page, /s-clickable-chip/);
    assert.match(page, /Clear all/);
    assert.match(page, /Search by document, invoice, order, customer, email/);
    assert.match(page, /kind=\$\{encodeURIComponent\(kind\)\}|kind=refund-documents/);
    assert.match(page, />\s*Document\s*</);
    assert.match(page, /slot="filters"/);
    assert.match(page, /documentTypeSwitcher/);
    assert.match(page, /No document refunds yet/);
    assert.match(page, /No credit notes yet/);
    assert.match(page, /listRefundDocumentTemplatesForShop/);
    assert.match(page, /fetchAndPrintRefundDocument/);
    assert.match(page, /downloadRefundDocumentPdf/);
    assert.match(page, /Print selected/);
    assert.match(page, /isCreditNotesListPath/);
    assert.match(page, /navigation\.location/);
    assert.doesNotMatch(
      page,
      /const loading = navigation\.state === "loading";/,
    );
    assert.doesNotMatch(page, /downloadRefundDocumentsBulkPdf|Download PDF/);
    assert.doesNotMatch(page, /numberColumnLabel|>\s*Reference\s*</);
    assert.doesNotMatch(page, /DOCUMENT_PAGE_SIZE_OPTIONS|Per page|Items per page/);
    assert.doesNotMatch(page, /buyerEmail/);
    assert.doesNotMatch(page, /listCreditNoteTemplatesForShop/);
    assert.doesNotMatch(page, /<s-tabs[<\\s]|<s-tab-list|<s-tab-panel/);

    const nav = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");
    assert.match(nav, /href="\/app\/credit-notes"/);

    const csvRoute = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.export.csv.tsx"),
      "utf8",
    );
    assert.match(csvRoute, /\\\\uFEFF|\\uFEFF/);
    assert.match(csvRoute, /creditNotesToCsv/);
  });

  it("uses Invoices-style row action menu: View, Copy, Copy customer link, Print, Download, Send email", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(page, /icon="view"/);
    assert.match(page, /icon="clipboard"/);
    assert.match(page, /icon="link"/);
    assert.match(page, /icon="print"/);
    assert.match(page, /icon="download"/);
    assert.match(page, /icon="email"/);
    assert.match(page, />\s*View\s*</);
    assert.match(page, />\s*Copy\s*</);
    assert.match(page, /Copy customer link/);
    assert.match(page, />\s*Print\s*</);
    assert.match(page, />\s*Download\s*</);
    assert.match(page, />\s*Send email\s*</);
    assert.match(page, /copyCreditNoteNumber/);
    assert.match(page, /const sendEmail = /);
    assert.match(page, /intent === "customer-link"/);
    assert.match(page, /issueCreditNotePublicLinkForShop/);
    assert.match(page, /"credit_note"/);
    assert.match(page, /"refund_document"/);
    assert.match(page, /Customer link copied/);
    assert.match(page, /Link created — opened in a new tab/);
  });

  it("wires Copy customer link on credit note and refund details", () => {
    const cnDetails = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id.tsx"),
      "utf8",
    );
    const refundDetails = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id_.refund.tsx"),
      "utf8",
    );

    assert.match(cnDetails, /Copy customer link/);
    assert.match(cnDetails, /intent === "customer-link"/);
    assert.match(cnDetails, /issueCreditNotePublicLinkForShop/);
    assert.match(cnDetails, /"credit_note"/);
    assert.doesNotMatch(cnDetails, /"refund_document"/);
    assert.match(cnDetails, /Customer link copied/);
    assert.match(cnDetails, /Link created — opened in a new tab/);

    assert.match(refundDetails, /Copy customer link/);
    assert.match(refundDetails, /intent === "customer-link"/);
    assert.match(refundDetails, /issueCreditNotePublicLinkForShop/);
    assert.match(refundDetails, /"refund_document"/);
    assert.doesNotMatch(refundDetails, /"credit_note"/);
    assert.match(refundDetails, /Customer link copied/);
    assert.match(refundDetails, /Link created — opened in a new tab/);
  });
});
