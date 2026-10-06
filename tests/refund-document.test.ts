import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  BULK_REFUND_DOCUMENT_LIMIT,
  getRefundDocumentDetailsForShop,
  listRefundDocumentTemplatesForShop,
  recordRefundDocumentDownload,
  refundDocumentPdfBasename,
  renderRefundDocument,
  renderRefundDocumentPdf,
  renderRefundDocumentsBulk,
} from "../app/models/credit-note-document.server";
import { createCreditNoteFromRefund } from "../app/models/credit-note.server";
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
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedCreditNote(opts?: { status?: string }) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `rd-doc-${randomUUID()}.myshopify.com`,
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
      invoiceNumber: `INV-RD-${randomUUID().slice(0, 6)}`,
      status: "generated",
      financialStatus: "partially_refunded",
      issueDate: new Date("2024-06-01T10:00:00Z"),
      currency: "AED",
      seller: {
        legalName: "Acme LLC",
        trn: "100000000000003",
        tradeLicence: "TL-1",
        address: {
          line1: "Street 1",
          city: "Dubai",
          emirate: "Dubai",
          country: "AE",
        },
      },
      buyer: {
        name: "RD Buyer",
        email: "rd@example.com",
        address: {
          line1: "Buyer St",
          city: "Abu Dhabi",
          emirate: "Abu Dhabi",
          country: "AE",
        },
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

  const creditNote = await createCreditNoteFromRefund(
    store.shopifyDomain,
    {
      id: Math.floor(Math.random() * 1e9),
      order_id: Number(orderId),
      created_at: "2024-07-01T12:00:00Z",
      note: "Customer return",
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "100.00",
          total_tax: "5.00",
          line_item: {
            title: "Widget",
            name: "Widget — Blue",
            sku: "SKU-A",
            variant_title: "Blue",
            price: "100.00",
          },
        },
      ],
      transactions: [{ amount: "105.00", currency: "AED", status: "success" }],
    },
    "sync",
  );

  assert.ok(creditNote);
  if (opts?.status && creditNote) {
    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: { status: opts.status },
    });
    creditNote.status = opts.status;
  }

  return { merchant, store, invoice, creditNote: creditNote! };
}

describe("listRefundDocumentTemplatesForShop", () => {
  it("lists active refund_document templates only", async () => {
    const { store } = await seedCreditNote();
    const templates = await listRefundDocumentTemplatesForShop(
      store.shopifyDomain,
    );
    assert.ok(templates && templates.length > 0);
    const allRefund = await prisma.invoiceTemplate.findMany({
      where: { id: { in: templates!.map((t) => t.id) } },
    });
    assert.ok(allRefund.every((t) => t.documentType === "refund_document"));
  });
});

describe("renderRefundDocument", () => {
  it("renders refund_document HTML with selected template", async () => {
    const { store, creditNote } = await seedCreditNote();
    const templates = await listRefundDocumentTemplatesForShop(
      store.shopifyDomain,
    );
    assert.ok(templates && templates.length > 0);
    const doc = await renderRefundDocument(
      store.shopifyDomain,
      creditNote.id,
      templates![0].id,
    );
    assert.ok(doc);
    assert.equal(doc!.documentType, "refund_document");
    assert.equal(doc!.templateId, templates![0].id);
    assert.match(doc!.html, /html|body|div/i);
    assert.equal(doc!.creditNoteNumber, creditNote.creditNoteNumber);
  });

  it("does not use credit_note documentType", async () => {
    const { store, creditNote } = await seedCreditNote();
    const doc = await renderRefundDocument(store.shopifyDomain, creditNote.id);
    assert.ok(doc);
    assert.equal(doc!.documentType, "refund_document");
    const tpl = await prisma.invoiceTemplate.findUnique({
      where: { id: doc!.templateId },
    });
    assert.equal(tpl?.documentType, "refund_document");
  });

  it("falls back to default when templateId is invalid", async () => {
    const { store, creditNote } = await seedCreditNote();
    const doc = await renderRefundDocument(
      store.shopifyDomain,
      creditNote.id,
      "not-a-real-template-id",
    );
    assert.ok(doc);
    assert.equal(doc!.documentType, "refund_document");
  });
});

describe("recordRefundDocumentDownload", () => {
  it("marks downloaded and creates event with refund_document metadata", async () => {
    const { store, creditNote } = await seedCreditNote({ status: "generated" });
    const templates = await listRefundDocumentTemplatesForShop(
      store.shopifyDomain,
    );
    assert.ok(templates?.[0]);
    await recordRefundDocumentDownload(
      store.shopifyDomain,
      creditNote.id,
      templates![0].id,
      templates![0].name,
    );
    const updated = await prisma.creditNote.findUnique({
      where: { id: creditNote.id },
    });
    assert.equal(updated!.status, "downloaded");
    const events = await prisma.invoiceStatusEvent.findMany({
      where: { creditNoteId: creditNote.id, status: "downloaded" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(events.length >= 1);
    assert.match(events[0].message ?? "", /Refund document downloaded/);
    const meta = events[0].metadata as {
      documentType?: string;
      templateId?: string;
    };
    assert.equal(meta.documentType, "refund_document");
    assert.equal(meta.templateId, templates![0].id);
  });
});

describe("renderRefundDocumentsBulk", () => {
  it("merges refund_document HTML and respects shared template", async () => {
    const { store, creditNote, invoice } = await seedCreditNote();
    const second = await createCreditNoteFromRefund(
      store.shopifyDomain,
      {
        id: Math.floor(Math.random() * 1e9),
        order_id: Number(invoice.shopifyOrderId),
        created_at: "2024-07-02T12:00:00Z",
        note: "Second return",
        refund_line_items: [
          {
            quantity: 1,
            subtotal: "50.00",
            total_tax: "2.50",
            line_item: {
              title: "Widget",
              name: "Widget — Blue",
              sku: "SKU-A",
              variant_title: "Blue",
              price: "50.00",
            },
          },
        ],
        transactions: [{ amount: "52.50", currency: "AED", status: "success" }],
      },
      "sync",
    );
    assert.ok(second);
    const templates = await listRefundDocumentTemplatesForShop(
      store.shopifyDomain,
    );
    const bulk = await renderRefundDocumentsBulk(
      store.shopifyDomain,
      [creditNote.id, second!.id],
      templates![0].id,
    );
    assert.ok(bulk);
    assert.equal(bulk!.count, 2);
    assert.equal(bulk!.templateId, templates![0].id);
    assert.match(bulk!.html, /Refund Documents|html/i);
  });

  it("exports bulk limit matching old app", () => {
    assert.equal(BULK_REFUND_DOCUMENT_LIMIT, 50);
  });
});

describe("refundDocumentPdfBasename", () => {
  it("matches old refund-{number} filename base", () => {
    assert.equal(refundDocumentPdfBasename("CN-00001"), "refund-CN-00001");
  });
});

describe("getRefundDocumentDetailsForShop", () => {
  it("returns refund_document URLs for the same CreditNote", async () => {
    const { store, creditNote } = await seedCreditNote();
    const details = await getRefundDocumentDetailsForShop(
      store.shopifyDomain,
      creditNote.id,
    );
    assert.ok(details);
    assert.match(details!.previewEmbedUrl, /\/refund-document\/view/);
    assert.match(details!.downloadUrl, /\/refund-document$/);
    assert.equal(details!.creditNoteNumber, creditNote.creditNoteNumber);
  });
});

describe("Refund document route wiring", () => {
  it("wires view without record; download records; bulk is print-only", () => {
    const viewSrc = readFileSync(
      join(
        process.cwd(),
        "app/routes/app.credit-notes_.$id_.refund-document.view.tsx",
      ),
      "utf8",
    );
    assert.match(viewSrc, /renderRefundDocument/);
    assert.doesNotMatch(viewSrc, /recordRefundDocumentDownload/);

    const downloadSrc = readFileSync(
      join(
        process.cwd(),
        "app/routes/app.credit-notes_.$id_.refund-document.tsx",
      ),
      "utf8",
    );
    assert.match(downloadSrc, /recordRefundDocumentDownload/);
    assert.match(downloadSrc, /renderRefundDocumentPdf/);
    assert.match(downloadSrc, /refundDocumentPdfBasename/);

    const bulkSrc = readFileSync(
      join(process.cwd(), "app/routes/app.refund-documents_.bulk.tsx"),
      "utf8",
    );
    assert.match(bulkSrc, /recordRefundDocumentDownload/);
    assert.match(bulkSrc, /renderRefundDocumentsBulk/);
    assert.match(bulkSrc, /BULK_REFUND_DOCUMENT_LIMIT/);
    assert.doesNotMatch(bulkSrc, /renderRefundDocumentsBulkPdf|pdfDownloadResponse/);
    assert.match(bulkSrc, /Bulk PDF download is not supported/);
  });

  it("wires details page to refund_document preview with Email primary and More actions", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id_.refund.tsx"),
      "utf8",
    );
    assert.match(source, /getRefundDocumentDetailsForShop/);
    assert.match(source, /listRefundDocumentTemplatesForShop/);
    assert.match(source, /renderRefundDocument/);
    assert.match(source, /downloadRefundDocumentPdf/);
    assert.match(source, /printRefundDocument/);
    assert.match(source, /sendRefundDocumentEmail/);
    assert.match(source, /trigger: "manual"/);
    assert.match(source, /const sendEmail = /);
    assert.match(source, /slot="primary-action"/);
    assert.match(source, />\s*Send email\s*</);
    assert.match(source, /commandFor=\{MORE_MENU_ID\}/);
    assert.match(source, />\s*More actions\s*</);
    assert.match(source, /icon="email"/);
    assert.match(source, /icon="clipboard"/);
    assert.match(source, /icon="print"/);
    assert.match(source, /icon="download"/);
    assert.equal(
      [...source.matchAll(/slot="secondary-actions"/g)].length,
      1,
      "Copy/Print/Download should only live under More actions",
    );
    assert.match(source, /Refund document/);
    assert.doesNotMatch(source, /s-modal|s-choice-list/);
    assert.doesNotMatch(source, /Copy link|QR code/i);
    assert.doesNotMatch(source, /DocumentEmailModal/);
  });

  it("wires list Refund Documents tab to refund document actions", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(page, /listRefundDocumentTemplatesForShop/);
    assert.match(page, /fetchAndPrintRefundDocument/);
    assert.match(page, /const sendEmail = /);
    assert.match(page, /sendRefundDocumentEmail/);
    assert.doesNotMatch(page, /DocumentEmailModal|s-modal|s-email-field/);
    assert.doesNotMatch(page, /Email refund document/);
    assert.match(page, /downloadRefundDocumentPdf/);
    assert.match(page, /fetchAndPrintRefundDocuments/);
    assert.match(page, /\/refund/);
    assert.match(page, /Print selected/);
    assert.match(page, /defaultRefundTemplateId/);
    assert.doesNotMatch(page, /downloadRefundDocumentsBulkPdf|downloadSelectedRefunds/);
    assert.doesNotMatch(page, /Download PDF/);
    assert.doesNotMatch(page, /REFUND_TEMPLATE_MODAL_ID|s-modal/);
  });
});

describe("renderRefundDocumentPdf", () => {
  it(
    "produces a PDF buffer when Chromium is available",
    { skip: !hasChromium },
    async () => {
      const { store, creditNote } = await seedCreditNote();
      const result = await renderRefundDocumentPdf(
        store.shopifyDomain,
        creditNote.id,
      );
      assert.ok(result);
      assert.ok(result!.pdf.length > 100);
      assert.equal(result!.doc.documentType, "refund_document");
    },
  );
});
