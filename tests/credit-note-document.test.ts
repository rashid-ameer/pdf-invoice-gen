import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  BULK_CREDIT_NOTE_LIMIT,
  creditNoteToRenderData,
  getCreditNoteDetailsForShop,
  listCreditNoteTemplatesForShop,
  recordCreditNoteDownload,
  renderCreditNoteDocument,
  renderCreditNoteDocumentPdf,
  renderCreditNotesBulk,
  renderCreditNotesBulkPdf,
} from "../app/models/credit-note-document.server";
import { createCreditNoteFromRefund } from "../app/models/credit-note.server";
import { ensureSystemTemplates } from "../app/models/template.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
} from "../app/models/document-preview.server";
import {
  htmlDocumentResponse,
  pdfDownloadResponse,
} from "../app/utils/document-response.server";
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
      shopifyDomain: `cn-doc-${randomUUID()}.myshopify.com`,
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
      invoiceNumber: `INV-CN-${randomUUID().slice(0, 6)}`,
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
        name: "CN Buyer",
        email: "cn@example.com",
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

describe("creditNoteToRenderData", () => {
  it("maps credit note number, original invoice, and reason", async () => {
    const { creditNote, invoice } = await seedCreditNote();
    const data = creditNoteToRenderData(
      creditNote,
      invoice.invoiceNumber,
      invoice.shopifyOrderNumber,
    );
    assert.equal(data.invoiceNumber, creditNote.creditNoteNumber);
    assert.equal(data.originalInvoiceNumber, invoice.invoiceNumber);
    assert.equal(data.reason, "Customer return");
    assert.ok(data.lineItems.length >= 1);
  });
});

describe("listCreditNoteTemplatesForShop", () => {
  it("lists active credit_note templates for the picker", async () => {
    const { store } = await seedCreditNote();
    const templates = await listCreditNoteTemplatesForShop(store.shopifyDomain);
    assert.ok(templates && templates.length > 0);
    assert.ok(templates!.every((t) => t.id && t.name));
  });
});

describe("renderCreditNoteDocument", () => {
  it("renders credit_note HTML with selected template", async () => {
    const { store, creditNote, invoice } = await seedCreditNote();
    const templates = await listCreditNoteTemplatesForShop(store.shopifyDomain);
    assert.ok(templates && templates.length > 0);

    const doc = await renderCreditNoteDocument(
      store.shopifyDomain,
      creditNote.id,
      templates![0].id,
    );
    assert.ok(doc);
    assert.equal(doc!.documentType, "credit_note");
    assert.equal(doc!.creditNoteNumber, creditNote.creditNoteNumber);
    assert.equal(doc!.originalInvoiceNumber, invoice.invoiceNumber);
    assert.equal(doc!.templateId, templates![0].id);
    assert.match(doc!.html, /html|body|div/i);
    assert.doesNotMatch(
      doc!.html,
      /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/,
    );
  });

  it("returns null for missing credit note", async () => {
    const { store } = await seedCreditNote();
    const doc = await renderCreditNoteDocument(
      store.shopifyDomain,
      "missing-id",
    );
    assert.equal(doc, null);
  });

  it("falls back to default template when templateId is invalid", async () => {
    const { store, creditNote } = await seedCreditNote();
    const doc = await renderCreditNoteDocument(
      store.shopifyDomain,
      creditNote.id,
      "not-a-real-template-id",
    );
    assert.ok(doc);
    assert.equal(doc!.documentType, "credit_note");
    assert.ok(doc!.templateId);
  });
});

describe("renderCreditNoteDocumentPdf", () => {
  it("returns null for missing credit note", async () => {
    const { store } = await seedCreditNote();
    assert.equal(
      await renderCreditNoteDocumentPdf(store.shopifyDomain, "missing-id"),
      null,
    );
  });

  it(
    "generates a PDF buffer with credit note filename base",
    { skip: !hasChromium ? "Chromium not configured" : false },
    async () => {
      const { store, creditNote } = await seedCreditNote();
      const result = await renderCreditNoteDocumentPdf(
        store.shopifyDomain,
        creditNote.id,
      );
      assert.ok(result);
      assert.ok(result!.pdf.length > 100);
      assert.equal(result!.doc.creditNoteNumber, creditNote.creditNoteNumber);

      const response = pdfDownloadResponse(
        result!.pdf,
        result!.doc.creditNoteNumber,
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("Content-Disposition") ?? "",
        /\.pdf/,
      );
    },
  );
});

describe("recordCreditNoteDownload", () => {
  it("marks generated credit note downloaded and creates status event", async () => {
    const { store, creditNote } = await seedCreditNote({ status: "generated" });
    const templates = await listCreditNoteTemplatesForShop(store.shopifyDomain);
    assert.ok(templates?.[0]);

    await recordCreditNoteDownload(
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
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].invoiceId, creditNote.invoiceId);
    assert.equal(events[0].source, "merchant");
    assert.match(events[0].message ?? "", /Credit note downloaded/);
    const meta = events[0].metadata as {
      documentType?: string;
      templateId?: string;
    };
    assert.equal(meta.documentType, "credit_note");
    assert.equal(meta.templateId, templates![0].id);
  });

  it("does not flip already-downloaded status but still records event", async () => {
    const { store, creditNote } = await seedCreditNote({
      status: "downloaded",
    });
    const templates = await listCreditNoteTemplatesForShop(store.shopifyDomain);
    const before = await prisma.invoiceStatusEvent.count({
      where: { creditNoteId: creditNote.id, status: "downloaded" },
    });

    await recordCreditNoteDownload(
      store.shopifyDomain,
      creditNote.id,
      templates![0].id,
      templates![0].name,
    );

    const updated = await prisma.creditNote.findUnique({
      where: { id: creditNote.id },
    });
    assert.equal(updated!.status, "downloaded");

    const after = await prisma.invoiceStatusEvent.count({
      where: { creditNoteId: creditNote.id, status: "downloaded" },
    });
    assert.equal(after, before + 1);
  });

  it("does not record when credit note is missing", async () => {
    const { store } = await seedCreditNote();
    await recordCreditNoteDownload(
      store.shopifyDomain,
      "missing",
      "tpl",
      "Template",
    );
    const events = await prisma.invoiceStatusEvent.count({
      where: { invoice: { storeId: store.id }, status: "downloaded" },
    });
    assert.equal(events, 0);
  });
});

describe("bulk credit notes", () => {
  it("merges HTML for selected credit notes and uses shared template", async () => {
    const a = await seedCreditNote();
    const b = await createCreditNoteFromRefund(
      a.store.shopifyDomain,
      {
        id: Math.floor(Math.random() * 1e9),
        order_id: Number(a.invoice.shopifyOrderId),
        created_at: "2024-07-02T12:00:00Z",
        note: "Second refund",
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
              price: "100.00",
            },
          },
        ],
        transactions: [{ amount: "52.50", currency: "AED", status: "success" }],
      },
      "sync",
    );
    assert.ok(b);

    const templates = await listCreditNoteTemplatesForShop(
      a.store.shopifyDomain,
    );
    const bulk = await renderCreditNotesBulk(
      a.store.shopifyDomain,
      [a.creditNote.id, b!.id, "missing"],
      templates![0].id,
    );
    assert.ok(bulk);
    assert.equal(bulk!.count, 2);
    assert.equal(bulk!.templateId, templates![0].id);
    assert.equal(bulk!.creditNoteNumbers.length, 2);
  });

  it(
    "bulk PDF uses combined filename base credit-notes-{count}",
    { skip: !hasChromium ? "Chromium not configured" : false },
    async () => {
      const { store, creditNote } = await seedCreditNote();
      const result = await renderCreditNotesBulkPdf(store.shopifyDomain, [
        creditNote.id,
      ]);
      assert.ok(result);
      assert.ok(result!.pdf.length > 100);
      const response = pdfDownloadResponse(
        result!.pdf,
        `credit-notes-${result!.count}`,
      );
      assert.match(
        response.headers.get("Content-Disposition") ?? "",
        /credit-notes-1\.pdf/,
      );
    },
  );

  it("exposes BULK_CREDIT_NOTE_LIMIT of 50", () => {
    assert.equal(BULK_CREDIT_NOTE_LIMIT, 50);
  });
});

describe("getCreditNoteDetailsForShop", () => {
  it("returns details with credit_note document URLs", async () => {
    const { store, creditNote, invoice } = await seedCreditNote();
    const details = await getCreditNoteDetailsForShop(
      store.shopifyDomain,
      creditNote.id,
    );
    assert.ok(details);
    assert.equal(details!.creditNoteNumber, creditNote.creditNoteNumber);
    assert.equal(details!.originalInvoiceNumber, invoice.invoiceNumber);
    assert.match(details!.previewEmbedUrl, /\/view\?embed=1/);
    assert.match(details!.downloadUrl, /\/download$/);
  });

  it("returns null when not found", async () => {
    const { store } = await seedCreditNote();
    const details = await getCreditNoteDetailsForShop(
      store.shopifyDomain,
      "missing",
    );
    assert.equal(details, null);
  });
});

describe("Credit note document routes / UI wiring", () => {
  it("wires details page to G5/G7 preview and Send email / More actions", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id.tsx"),
      "utf8",
    );
    assert.match(source, /getCreditNoteDetailsForShop/);
    assert.match(source, /listCreditNoteTemplatesForShop/);
    assert.match(source, /renderCreditNoteDocument/);
    assert.match(source, /slot="breadcrumb-actions"/);
    assert.match(source, /href="\/app\/credit-notes"/);
    assert.match(source, /slot="primary-action"/);
    assert.match(source, />\s*Send email\s*</);
    assert.match(source, /commandFor=\{MORE_MENU_ID\}/);
    assert.match(source, />\s*More actions\s*</);
    assert.match(source, /icon="clipboard"/);
    assert.match(source, /icon="print"/);
    assert.match(source, /icon="download"/);
    assert.match(source, /icon="email"/);
    assert.equal(
      [...source.matchAll(/slot="secondary-actions"/g)].length,
      1,
      "Copy/Print/Download should only live under More actions",
    );
    assert.match(source, /copyCreditNoteNumber/);
    assert.match(source, /openDownload/);
    assert.match(source, /downloadCreditNotePdf/);
    assert.match(source, /sendCreditNoteEmail/);
    assert.match(source, /trigger: "manual"/);
    assert.match(source, /const sendEmail = /);
    assert.match(source, /printCreditNote/);
    assert.match(source, /printInvoiceHtml/);
    assert.match(source, /srcDoc=\{previewHtml\}/);
    assert.match(source, /Credit note not found/);
    assert.match(source, /Back to Credit notes/);
    assert.doesNotMatch(source, /s-modal|s-choice-list|Print credit note/);
    assert.doesNotMatch(source, /Copy link|QR code|public link/i);
    assert.doesNotMatch(source, /DocumentEmailModal/);
    assert.doesNotMatch(source, /refund_document/);
  });

  it("wires list page View/Print/Download/Email/bulk with selection", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(source, /Print selected/);
    assert.match(source, /BULK_PRINT_LIMIT|50/);
    assert.match(source, /s-menu/);
    assert.match(source, /menu-horizontal/);
    assert.match(source, /downloadCreditNotePdf/);
    assert.match(source, /fetchAndPrintCreditNoteDocument/);
    assert.match(source, /const sendEmail = /);
    assert.match(source, /sendCreditNoteEmail/);
    assert.match(source, /Send email/);
    assert.doesNotMatch(source, /DocumentEmailModal|s-modal|s-email-field/);
    assert.match(source, /sendRefundDocumentEmail/);
    assert.match(source, /trigger: "manual"/);
    assert.match(source, /fetchAndPrintCreditNoteDocuments/);
    assert.match(source, />\s*View\s*</);
    assert.match(source, /\/app\/credit-notes\/\$\{/);
    assert.match(source, /hasSelection/);
    assert.doesNotMatch(source, /DOCUMENT_PAGE_SIZE_OPTIONS|Per page/);
    assert.doesNotMatch(source, /buyerEmail/);
    assert.match(source, /listRefundDocumentTemplatesForShop/);
    assert.match(source, /fetchAndPrintRefundDocument/);
  });

  it("view route does not record download; download and bulk do", () => {
    const viewSrc = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id.view.tsx"),
      "utf8",
    );
    assert.match(viewSrc, /renderCreditNoteDocument/);
    assert.doesNotMatch(viewSrc, /recordCreditNoteDownload/);

    const downloadSrc = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id.download.tsx"),
      "utf8",
    );
    assert.match(downloadSrc, /recordCreditNoteDownload/);
    assert.match(downloadSrc, /renderCreditNoteDocumentPdf/);

    const bulkSrc = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.bulk.tsx"),
      "utf8",
    );
    assert.match(bulkSrc, /BULK_CREDIT_NOTE_LIMIT/);
    assert.match(bulkSrc, /You can print up to 50 credit notes at once/);
    assert.match(bulkSrc, /recordCreditNoteDownload/);
    assert.match(bulkSrc, /mode === "download"/);
    assert.match(bulkSrc, /credit-notes-\$\{result\.count\}/);
  });

  it("renders HTML viewer markup with download link", async () => {
    const { store, creditNote } = await seedCreditNote();
    const doc = await renderCreditNoteDocument(
      store.shopifyDomain,
      creditNote.id,
    );
    assert.ok(doc);
    const viewer = wrapA4DocumentViewerHtml(applyA4DocumentLayout(doc!.html), {
      title: `Credit note ${doc!.creditNoteNumber}`,
      subtitle: `Template: ${doc!.templateName} · A4`,
      downloadUrl: `/app/credit-notes/${creditNote.id}/download?templateId=${doc!.templateId}`,
    });
    assert.match(viewer, /Download|Print|Credit note/i);
    assert.match(viewer, /\/app\/credit-notes\/.*\/download/);
    const response = htmlDocumentResponse(viewer);
    assert.equal(response.status, 200);
  });
});
