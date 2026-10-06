import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  applyPlaceholders,
  getDeliverySettings,
  hasEmailSentEvent,
  normalizeDeliverySettings,
  parseCcList,
  previewDocumentEmail,
  restoreDocumentEmailHooks,
  saveDeliverySettings,
  scheduleCreditNoteAutoEmails,
  scheduleInvoiceAutoEmail,
  scheduleInvoiceAutoEmailOnPaid,
  sendCreditNoteEmail,
  sendDocumentEmail,
  sendDocumentTestEmail,
  sendInvoiceEmail,
  sendRefundDocumentEmail,
  setDocumentEmailLinkResolver,
  shouldAutoSendCreditNote,
  shouldAutoSendInvoice,
  shouldAutoSendInvoiceOnPaid,
  shouldAutoSendRefundDocument,
} from "../app/models/document-email.server";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  normalizeEmailBodyContent,
  normalizeEmailLayout,
  normalizeQuillLists,
  renderBrandedEmail,
  sanitizeEmailBodyHtml,
} from "../app/models/email-template.server";
import { pdfFilename } from "../app/models/pdf-cache.server";
import {
  setResendTransportForTests,
  type ResendSendInput,
} from "../app/models/resend.server";
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

afterEach(() => {
  setResendTransportForTests(null);
  restoreDocumentEmailHooks();
});

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: { invoice: { storeId: row.storeId } },
    });
    await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.legalEntity.deleteMany({ where: { merchantId: row.merchantId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStoreWithInvoice(opts?: { buyerEmail?: string | null }) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `email-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });

  const entity = await prisma.legalEntity.create({
    data: {
      merchantId: merchant.id,
      legalName: "Acme Trading LLC",
      trn: "100000000000003",
      tin: "1000000000",
      businessEmail: "billing@acme.test",
      address: {
        line1: "Street 1",
        city: "Dubai",
        emirate: "Dubai",
        country: "AE",
      },
      emirate: "Dubai",
    },
  });
  await prisma.store.update({
    where: { id: store.id },
    data: { defaultLegalEntityId: entity.id },
  });

  const orderId = String(Math.floor(Math.random() * 1e9));
  const buyerEmail =
    opts?.buyerEmail === null
      ? undefined
      : (opts?.buyerEmail ?? "buyer@example.com");
  const invoice = await prisma.invoice.create({
    data: {
      merchantId: merchant.id,
      storeId: store.id,
      legalEntityId: entity.id,
      shopifyOrderId: orderId,
      shopifyOrderNumber: `#${orderId}`,
      invoiceNumber: `INV-${randomUUID().slice(0, 6)}`,
      status: "generated",
      financialStatus: "paid",
      issueDate: new Date("2024-06-01T10:00:00Z"),
      currency: "AED",
      seller: {
        legalName: "Acme Trading LLC",
        address: { city: "Dubai", country: "AE" },
      },
      buyer: {
        name: "Ada Buyer",
        ...(buyerEmail ? { email: buyerEmail } : {}),
      },
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
        discount: 0,
        vatTotal: 5,
        shipping: 0,
        grandTotal: 105,
      },
    },
  });

  return { merchant, store, invoice, entity };
}

async function seedCreditNoteForStore(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const invoice = await prisma.invoice.findFirst({ where: { storeId } });
  assert.ok(invoice);
  const note = await createCreditNoteFromRefund(
    store.shopifyDomain,
    {
      id: Math.floor(Math.random() * 1e9),
      order_id: Number(invoice.shopifyOrderId),
      created_at: "2024-07-01T12:00:00Z",
      note: "Customer return",
      refund_line_items: [
        {
          quantity: 1,
          subtotal: "100.00",
          total_tax: "5.00",
          line_item: {
            title: "Widget",
            name: "Widget",
            sku: "SKU-A",
            price: "100.00",
          },
        },
      ],
      transactions: [{ amount: "105.00", currency: "AED", status: "success" }],
    },
    "sync",
  );
  assert.ok(note);
  return note!;
}

describe("auto-send decisions ignore global enabled", () => {
  it("gates only on per-document auto-send and invoiceWhen", () => {
    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: true, invoiceWhen: "paid" },
        true,
      ),
      true,
    );
    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: true, invoiceWhen: "paid" },
        false,
      ),
      false,
    );
    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: true, invoiceWhen: "created" },
        false,
      ),
      true,
    );
    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: false, invoiceWhen: "paid" },
        true,
      ),
      false,
    );

    assert.equal(
      shouldAutoSendInvoiceOnPaid({
        invoiceAutoSend: true,
        invoiceWhen: "paid",
      }),
      true,
    );
    assert.equal(
      shouldAutoSendInvoiceOnPaid({
        invoiceAutoSend: true,
        invoiceWhen: "created",
      }),
      false,
    );
    assert.equal(
      shouldAutoSendInvoiceOnPaid({
        invoiceAutoSend: false,
        invoiceWhen: "paid",
      }),
      false,
    );

    assert.equal(shouldAutoSendCreditNote({ creditNoteAutoSend: true }), true);
    assert.equal(shouldAutoSendCreditNote({ creditNoteAutoSend: false }), false);
    assert.equal(
      shouldAutoSendRefundDocument({ refundDocumentAutoSend: true }),
      true,
    );
    assert.equal(
      shouldAutoSendRefundDocument({ refundDocumentAutoSend: false }),
      false,
    );

    // Stored `enabled` is not an input to these helpers.
    const withMasterOff = normalizeDeliverySettings({
      enabled: false,
      invoiceAutoSend: true,
      invoiceWhen: "paid",
      creditNoteAutoSend: true,
      refundDocumentAutoSend: true,
    });
    assert.equal(withMasterOff.enabled, false);
    assert.equal(shouldAutoSendInvoice(withMasterOff, true), true);
    assert.equal(shouldAutoSendCreditNote(withMasterOff), true);
    assert.equal(shouldAutoSendRefundDocument(withMasterOff), true);

    const withMasterOn = normalizeDeliverySettings({
      enabled: true,
      invoiceAutoSend: false,
      creditNoteAutoSend: false,
      refundDocumentAutoSend: false,
    });
    assert.equal(withMasterOn.enabled, true);
    assert.equal(shouldAutoSendInvoice(withMasterOn, true), false);
    assert.equal(shouldAutoSendCreditNote(withMasterOn), false);
    assert.equal(shouldAutoSendRefundDocument(withMasterOn), false);
  });

  it("still accepts and stores enabled when saving settings (compatibility only)", async () => {
    const { store } = await seedStoreWithInvoice();
    const saved = await saveDeliverySettings(store.shopifyDomain, {
      enabled: false,
      invoiceAutoSend: true,
      creditNoteAutoSend: true,
    });
    assert.ok(saved);
    assert.equal(saved!.enabled, false);
    assert.equal(saved!.invoiceAutoSend, true);
    assert.equal(saved!.creditNoteAutoSend, true);

    const again = await getDeliverySettings(store.shopifyDomain);
    assert.equal(again!.enabled, false);
    assert.equal(again!.invoiceAutoSend, true);
  });

  it("does not auto-send when document auto-send is off even if enabled is on", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    await saveDeliverySettings(store.shopifyDomain, {
      enabled: true,
      invoiceAutoSend: false,
      creditNoteAutoSend: false,
      refundDocumentAutoSend: false,
    });

    let sends = 0;
    setResendTransportForTests(async () => {
      sends += 1;
      return { ok: true, id: "re_skip", from: "from@test.com" };
    });

    await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, true);
    await scheduleInvoiceAutoEmailOnPaid(store.shopifyDomain, invoice.id);
    assert.equal(sends, 0);
  });

  it(
    "auto-sends invoice when invoiceAutoSend is on even if enabled is off",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: false,
        invoiceAutoSend: true,
        invoiceWhen: "paid",
      });

      let sends = 0;
      setResendTransportForTests(async (input) => {
        sends += 1;
        assert.ok(input.pdf);
        return { ok: true, id: "re_auto", from: "from@test.com" };
      });

      await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, true);
      assert.equal(sends, 1);
      assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), true);
    },
  );

  it("skips invoice auto-send when waiting for paid trigger", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    await saveDeliverySettings(store.shopifyDomain, {
      enabled: false,
      invoiceAutoSend: true,
      invoiceWhen: "paid",
    });

    let sends = 0;
    setResendTransportForTests(async () => {
      sends += 1;
      return { ok: true, id: "re_wait", from: "from@test.com" };
    });

    await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, false);
    assert.equal(sends, 0);
  });

  it(
    "auto-sends credit note / refund by their own flags independently of enabled",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      const note = await seedCreditNoteForStore(store.id);
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: false,
        creditNoteAutoSend: true,
        refundDocumentAutoSend: false,
      });

      const kinds: string[] = [];
      setResendTransportForTests(async (input) => {
        kinds.push(input.filename || input.subject);
        return { ok: true, id: `re_${kinds.length}`, from: "from@test.com" };
      });

      await scheduleCreditNoteAutoEmails(store.shopifyDomain, note.id);
      assert.equal(kinds.length, 1);
      assert.equal(
        await hasEmailSentEvent(invoice.id, "credit_note", note.id),
        true,
      );
      assert.equal(
        await hasEmailSentEvent(invoice.id, "refund_document", note.id),
        false,
      );
    },
  );

  it("automations are independent across document types", async () => {
    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: false, invoiceWhen: "paid" },
        true,
      ),
      false,
    );
    assert.equal(
      shouldAutoSendCreditNote({ creditNoteAutoSend: true }),
      true,
    );
    assert.equal(
      shouldAutoSendRefundDocument({ refundDocumentAutoSend: true }),
      true,
    );

    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: true, invoiceWhen: "created" },
        false,
      ),
      true,
    );
    assert.equal(
      shouldAutoSendCreditNote({ creditNoteAutoSend: false }),
      false,
    );
    assert.equal(
      shouldAutoSendRefundDocument({ refundDocumentAutoSend: false }),
      false,
    );

    assert.equal(
      shouldAutoSendInvoice(
        { invoiceAutoSend: false, invoiceWhen: "paid" },
        true,
      ),
      false,
    );
    assert.equal(
      shouldAutoSendCreditNote({ creditNoteAutoSend: false }),
      false,
    );
    assert.equal(
      shouldAutoSendRefundDocument({ refundDocumentAutoSend: true }),
      true,
    );
  });
});

describe("normalizeDeliverySettings", () => {
  it("applies old defaults for empty input", () => {
    const settings = normalizeDeliverySettings(null);
    assert.equal(settings.enabled, false);
    assert.equal(settings.invoiceAutoSend, false);
    assert.equal(settings.invoiceWhen, "paid");
    assert.equal(settings.creditNoteAutoSend, false);
    assert.equal(settings.refundDocumentAutoSend, false);
    assert.equal(settings.emailLayout, "classic");
    assert.equal(settings.showViewButton, true);
    assert.equal(settings.invoiceBodyMode, "designed");
    assert.match(settings.invoiceSubject, /invoice_number/);
    assert.ok(settings.invoiceBody.includes("invoice_number"));
  });

  it("normalizes partial and invalid values", () => {
    const settings = normalizeDeliverySettings({
      enabled: "1",
      invoiceWhen: "created",
      emailLayout: "nope",
      invoiceBodyMode: "custom_html",
      invoiceSubject: "Hello {{invoice_number}}",
    });
    assert.equal(settings.enabled, true);
    assert.equal(settings.invoiceWhen, "created");
    assert.equal(settings.emailLayout, "classic");
    assert.equal(settings.invoiceBodyMode, "custom_html");
    assert.equal(settings.invoiceSubject, "Hello {{invoice_number}}");
    assert.equal(settings.invoiceBody, DEFAULT_INVOICE_EMAIL_BODY);
  });
});

describe("delivery settings persistence", () => {
  it("loads defaults and saves store-scoped settings", async () => {
    const { store } = await seedStoreWithInvoice();
    const loaded = await getDeliverySettings(store.shopifyDomain);
    assert.ok(loaded);
    assert.equal(loaded!.enabled, false);
    assert.equal(loaded!.fromName, "Acme Trading LLC");
    assert.equal(loaded!.replyTo, "billing@acme.test");

    const saved = await saveDeliverySettings(store.shopifyDomain, {
      enabled: true,
      invoiceAutoSend: true,
      invoiceWhen: "created",
      fromName: "Custom From",
      replyTo: "reply@store.test",
      ccStaff: "a@x.com, b@y.com",
    });
    assert.ok(saved);
    assert.equal(saved!.enabled, true);
    assert.equal(saved!.invoiceAutoSend, true);
    assert.equal(saved!.invoiceWhen, "created");
    assert.equal(saved!.fromName, "Custom From");
    assert.equal(saved!.ccStaff, "a@x.com, b@y.com");

    const again = await getDeliverySettings(store.shopifyDomain);
    assert.equal(again!.enabled, true);
    assert.equal(again!.invoiceWhen, "created");
  });

  it("isolates settings between stores", async () => {
    const a = await seedStoreWithInvoice();
    const b = await seedStoreWithInvoice();
    await saveDeliverySettings(a.store.shopifyDomain, { enabled: true });
    const settingsB = await getDeliverySettings(b.store.shopifyDomain);
    assert.equal(settingsB!.enabled, false);
  });
});

describe("placeholders and CC", () => {
  it("replaces known placeholders and blanks unknown keys", () => {
    const out = applyPlaceholders(
      "Hi {{customer_name}} / {{missing}} / {{invoice_number}}",
      { customer_name: "Ada", invoice_number: "INV-1" },
    );
    assert.equal(out, "Hi Ada /  / INV-1");
  });

  it("parses comma, semicolon, and whitespace CC lists", () => {
    assert.deepEqual(parseCcList("a@x.com, b@y.com;c@z.com  d@w.com"), [
      "a@x.com",
      "b@y.com",
      "c@z.com",
      "d@w.com",
    ]);
    assert.deepEqual(parseCcList("not-an-email, ok@test.com"), ["ok@test.com"]);
    assert.deepEqual(parseCcList(""), []);
  });

  it("normalizes email layouts", () => {
    assert.equal(normalizeEmailLayout("minimal"), "minimal");
    assert.equal(normalizeEmailLayout("card"), "card");
    assert.equal(normalizeEmailLayout("classic"), "classic");
    assert.equal(normalizeEmailLayout("other"), "classic");
  });
});

describe("designed body Quill HTML pipeline", () => {
  it("keeps placeholders intact through sanitize/normalize", () => {
    const html =
      "<p>Hello {{customer_name}}, invoice {{invoice_number}} from {{shop_name}}.</p>";
    const out = normalizeEmailBodyContent(html);
    assert.match(out, /\{\{customer_name\}\}/);
    assert.match(out, /\{\{invoice_number\}\}/);
    assert.match(out, /\{\{shop_name\}\}/);
  });

  it("strips scripts and unsafe links like the old sanitizer", () => {
    const dirty =
      '<p>Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://ok.example">ok</a>';
    const out = sanitizeEmailBodyHtml(dirty);
    assert.doesNotMatch(out, /<script/i);
    assert.doesNotMatch(out, /javascript:/i);
    assert.match(out, /https:\/\/ok\.example/);
  });

  it("converts Quill 2 bullet lists to email-safe ul", () => {
    const quillOl =
      '<ol><li data-list="bullet">One</li><li data-list="bullet">Two</li></ol>';
    const out = normalizeQuillLists(quillOl);
    assert.match(out, /<ul[\s>]/i);
    assert.match(out, /list-style-type:disc/);
    assert.match(out, /One/);
    assert.match(out, /Two/);
  });
});

describe("email composition", () => {
  it("renders branded HTML for designed body with placeholders", async () => {
    const settings = normalizeDeliverySettings({
      fromName: "Shop Co",
      emailLayout: "classic",
      showViewButton: true,
    });
    const preview = await previewDocumentEmail({
      shop: "shop.myshopify.com",
      settings,
      documentKind: "invoice",
      documentLink: "https://example.com/inv",
    });
    assert.match(preview.html, /INV-10042|invoice/i);
    assert.match(preview.html, /Alex Customer/);
    assert.match(preview.html, /View invoice/);
    assert.match(preview.text, /Alex Customer/);
  });

  it("renders custom HTML mode without inventing wrappers for full documents", () => {
    const result = renderBrandedEmail({
      layout: "classic",
      showViewButton: false,
      documentKind: "invoice",
      bodyMode: "custom_html",
      bodyContent: "<p>Hello</p>",
      customBodyContent: "<!DOCTYPE html><html><body><p>Custom {{x}}</p></body></html>",
      shopName: "Shop",
      branding: {
        primaryColor: "#0d5c45",
        secondaryColor: "#6b7280",
        accentColor: "#0d5c45",
        logoUrl: "",
        footerText: "Thanks",
        socialLinks: { visible: false, links: [] },
      },
    });
    assert.match(result.html, /Custom/);
    assert.match(result.text, /Custom/);
  });
});

describe("pdf filenames", () => {
  it("preserves invoice, credit note, and Refund- basename rules", () => {
    assert.equal(pdfFilename("INV-100"), "INV-100.pdf");
    assert.equal(pdfFilename("CN-100"), "CN-100.pdf");
    assert.equal(pdfFilename("Refund-CN-100"), "Refund-CN-100.pdf");
  });
});

describe("recipient resolution and events", () => {
  it("fails when customer email is missing", async () => {
    const { store, invoice } = await seedStoreWithInvoice({ buyerEmail: null });
    const result = await sendInvoiceEmail({
      shop: store.shopifyDomain,
      invoiceId: invoice.id,
      trigger: "manual",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Customer email is missing");
  });

  it("prefers explicit to over buyer email (idempotent auto skip without PDF)", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    await prisma.invoiceStatusEvent.create({
      data: {
        invoiceId: invoice.id,
        status: "email_sent",
        source: "system",
        message: "already",
        metadata: { documentType: "tax_invoice", trigger: "auto" },
      },
    });
    assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), true);

    const skipped = await sendInvoiceEmail({
      shop: store.shopifyDomain,
      invoiceId: invoice.id,
      to: "override@example.com",
      trigger: "auto",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.to, "override@example.com");
  });

  it("does not skip auto when only email_failed exists", async () => {
    const { invoice } = await seedStoreWithInvoice();
    await prisma.invoiceStatusEvent.create({
      data: {
        invoiceId: invoice.id,
        status: "email_failed",
        source: "system",
        message: "failed",
        metadata: { documentType: "tax_invoice", trigger: "auto" },
      },
    });
    assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), false);
  });
});

describe("send via mocked Resend", () => {
  it(
    "records email_sent for invoice manual send with PDF",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      const captured: { current: ResendSendInput | null } = { current: null };
      setResendTransportForTests(async (input) => {
        captured.current = input;
        return {
          ok: true,
          id: "re_test_1",
          from: "Shop <from@test.com>",
          lastEvent: "sent",
        };
      });

      const result = await sendInvoiceEmail({
        shop: store.shopifyDomain,
        invoiceId: invoice.id,
        trigger: "manual",
      });
      assert.equal(result.ok, true);
      assert.equal(result.providerId, "re_test_1");
      assert.ok(captured.current);
      assert.equal(captured.current.to, "buyer@example.com");
      assert.ok(captured.current.pdf?.length);
      assert.match(captured.current.filename || "", /\.pdf$/i);

      const events = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_sent" },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].source, "merchant");
      const meta = events[0].metadata as { documentType?: string; trigger?: string };
      assert.equal(meta.documentType, "tax_invoice");
      assert.equal(meta.trigger, "manual");
    },
  );

  it(
    "records email_failed on Resend error",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      setResendTransportForTests(async () => ({
        ok: false,
        error: "Resend boom",
      }));

      const result = await sendInvoiceEmail({
        shop: store.shopifyDomain,
        invoiceId: invoice.id,
        trigger: "manual",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "Resend boom");

      const failed = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_failed" },
      });
      assert.equal(failed.length, 1);
      const sent = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_sent" },
      });
      assert.equal(sent.length, 0);
    },
  );

  it(
    "manual send is not blocked by prior email_sent",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      await prisma.invoiceStatusEvent.create({
        data: {
          invoiceId: invoice.id,
          status: "email_sent",
          source: "system",
          message: "auto",
          metadata: { documentType: "tax_invoice", trigger: "auto" },
        },
      });
      setResendTransportForTests(async () => ({
        ok: true,
        id: "re_manual_2",
        from: "from@test.com",
      }));

      const result = await sendInvoiceEmail({
        shop: store.shopifyDomain,
        invoiceId: invoice.id,
        to: "again@example.com",
        trigger: "manual",
      });
      assert.equal(result.ok, true);
      const sent = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_sent" },
      });
      assert.equal(sent.length, 2);
    },
  );

  it(
    "sends credit note and refund document emails",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      const note = await seedCreditNoteForStore(store.id);
      const filenames: string[] = [];
      setResendTransportForTests(async (input) => {
        filenames.push(input.filename || "");
        return { ok: true, id: `re_${filenames.length}`, from: "from@test.com" };
      });

      const cn = await sendCreditNoteEmail({
        shop: store.shopifyDomain,
        creditNoteId: note!.id,
        trigger: "manual",
      });
      assert.equal(cn.ok, true);

      const rd = await sendRefundDocumentEmail({
        shop: store.shopifyDomain,
        creditNoteId: note!.id,
        trigger: "manual",
      });
      assert.equal(rd.ok, true);
      assert.ok(filenames.some((f) => f.includes("Refund")));

      const events = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, creditNoteId: note!.id, status: "email_sent" },
      });
      assert.equal(events.length, 2);
    },
  );

  it("test email has no PDF and creates no document status events", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    const captured: { current: ResendSendInput | null } = { current: null };
    setResendTransportForTests(async (input) => {
      captured.current = input;
      return { ok: true, id: "re_test", from: "from@test.com" };
    });

    const settings = (await getDeliverySettings(store.shopifyDomain))!;
    const result = await sendDocumentTestEmail({
      shop: store.shopifyDomain,
      to: "me@store.test",
      documentKind: "invoice",
      settings,
      subjectTemplate: settings.invoiceSubject,
    });
    assert.equal(result.ok, true);
    assert.ok(captured.current);
    assert.equal(captured.current.pdf, undefined);
    assert.match(captured.current.subject, /^\[Test\]/);

    const events = await prisma.invoiceStatusEvent.findMany({
      where: { invoiceId: invoice.id },
    });
    assert.equal(events.length, 0);
  });

  it("sendDocumentEmail rejects packing slips via unsupported type", async () => {
    const result = await sendDocumentEmail({
      shop: "x.myshopify.com",
      documentType: "packing_slip" as never,
      invoiceId: "x",
      trigger: "manual",
    });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /Unsupported|not found/i);
  });
});

describe("Phase 4 automatic email schedule behavior", () => {
  it(
    "invoiceWhen=created sends on create even when unpaid; paid replay skips",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: true,
        invoiceAutoSend: true,
        invoiceWhen: "created",
      });

      let sends = 0;
      setResendTransportForTests(async () => {
        sends += 1;
        return { ok: true, id: `re_created_${sends}`, from: "from@test.com" };
      });

      await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, false);
      assert.equal(sends, 1);
      assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), true);

      await scheduleInvoiceAutoEmailOnPaid(store.shopifyDomain, invoice.id);
      assert.equal(sends, 1, "paid trigger must not send when invoiceWhen=created");
    },
  );

  it(
    "invoiceWhen=paid sends on paid and skips duplicate paid calls",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: true,
        invoiceAutoSend: true,
        invoiceWhen: "paid",
      });

      let sends = 0;
      setResendTransportForTests(async () => {
        sends += 1;
        return { ok: true, id: `re_paid_${sends}`, from: "from@test.com" };
      });

      await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, false);
      assert.equal(sends, 0, "create while unpaid must wait");

      await scheduleInvoiceAutoEmailOnPaid(store.shopifyDomain, invoice.id);
      assert.equal(sends, 1);

      await scheduleInvoiceAutoEmailOnPaid(store.shopifyDomain, invoice.id);
      assert.equal(sends, 1, "duplicate paid must skip");

      const events = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_sent" },
      });
      assert.equal(events.length, 1);
    },
  );

  it(
    "email failure does not block document and allows later auto retry",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: true,
        invoiceAutoSend: true,
        invoiceWhen: "created",
      });

      setResendTransportForTests(async () => ({
        ok: false,
        error: "Resend temporary failure",
      }));

      await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, true);
      assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), false);

      const failed = await prisma.invoiceStatusEvent.findMany({
        where: { invoiceId: invoice.id, status: "email_failed" },
      });
      assert.ok(failed.length >= 1);

      const stillThere = await prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      assert.ok(stillThere);

      let sends = 0;
      setResendTransportForTests(async () => {
        sends += 1;
        return { ok: true, id: "re_retry", from: "from@test.com" };
      });
      await scheduleInvoiceAutoEmail(store.shopifyDomain, invoice.id, true);
      assert.equal(sends, 1);
      assert.equal(await hasEmailSentEvent(invoice.id, "tax_invoice"), true);
    },
  );

  it(
    "sends both credit note and refund document when both flags are on",
    { skip: !hasChromium },
    async () => {
      const { store, invoice } = await seedStoreWithInvoice();
      const note = await seedCreditNoteForStore(store.id);
      await saveDeliverySettings(store.shopifyDomain, {
        enabled: true,
        creditNoteAutoSend: true,
        refundDocumentAutoSend: true,
      });

      let sends = 0;
      setResendTransportForTests(async () => {
        sends += 1;
        return { ok: true, id: `re_both_${sends}`, from: "from@test.com" };
      });

      await scheduleCreditNoteAutoEmails(store.shopifyDomain, note.id);
      assert.equal(sends, 2);
      assert.equal(
        await hasEmailSentEvent(invoice.id, "credit_note", note.id),
        true,
      );
      assert.equal(
        await hasEmailSentEvent(invoice.id, "refund_document", note.id),
        true,
      );

      await scheduleCreditNoteAutoEmails(store.shopifyDomain, note.id);
      assert.equal(sends, 2, "second schedule must be idempotent");
    },
  );

  it("email failure does not prevent credit note schedule from completing", async () => {
    const { store } = await seedStoreWithInvoice();
    const note = await seedCreditNoteForStore(store.id);
    await saveDeliverySettings(store.shopifyDomain, {
      enabled: true,
      creditNoteAutoSend: true,
      refundDocumentAutoSend: false,
    });

    setResendTransportForTests(async () => ({
      ok: false,
      error: "provider down",
    }));

    await scheduleCreditNoteAutoEmails(store.shopifyDomain, note.id);
    const stillThere = await prisma.creditNote.findUnique({
      where: { id: note.id },
    });
    assert.ok(stillThere);
  });
});

describe("Phase 4 lifecycle wiring (source inspection)", () => {
  it("wires invoice create / paid schedule at old call sites", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const create = readFileSync(
      join(process.cwd(), "app/models/invoice-create.server.ts"),
      "utf8",
    );
    assert.match(create, /scheduleInvoiceAutoEmail\(/);
    assert.match(create, /scheduleInvoiceAutoEmailOnPaid\(/);
    assert.match(create, /orderIsPaid/);

    const ordersPaid = readFileSync(
      join(process.cwd(), "app/routes/webhooks.orders.paid.tsx"),
      "utf8",
    );
    const ordersCreate = readFileSync(
      join(process.cwd(), "app/routes/webhooks.orders.create.tsx"),
      "utf8",
    );
    assert.match(ordersPaid, /handleOrderCreated/);
    assert.match(ordersCreate, /handleOrderCreated/);
  });

  it("wires credit-note auto emails after successful create (webhook + sync)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const cn = readFileSync(
      join(process.cwd(), "app/models/credit-note.server.ts"),
      "utf8",
    );
    assert.match(cn, /scheduleCreditNoteAutoEmails\(/);
    assert.match(cn, /createCreditNoteFromRefund/);
    assert.match(cn, /handleRefundCreated/);

    const sync = readFileSync(
      join(process.cwd(), "app/models/refund-sync.server.ts"),
      "utf8",
    );
    assert.match(sync, /createCreditNoteFromRefund/);
  });
});

describe("Group 13 Phase D — email public-link resolver", () => {
  it("wires default resolver to Phase A ForShop helpers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const emailSrc = readFileSync(
      join(process.cwd(), "app/models/document-email.server.ts"),
      "utf8",
    );
    assert.match(emailSrc, /issueInvoicePublicLinkForShop/);
    assert.match(emailSrc, /issueCreditNotePublicLinkForShop/);
    assert.match(emailSrc, /defaultDocumentLinkResolver/);
    assert.match(emailSrc, /documentType === "tax_invoice"/);
    assert.match(emailSrc, /documentType === "refund_document"/);
    assert.match(emailSrc, /"credit_note"/);
    assert.match(emailSrc, /invoice_link:/);
    assert.match(emailSrc, /credit_note_link:/);
    assert.match(emailSrc, /refund_link:/);
    assert.match(emailSrc, /document_link:/);
    assert.match(emailSrc, /\[email\] public link resolver failed/);
    assert.match(emailSrc, /\[email\] invoice public link issue failed/);
  });

  it("resolves invoice_link / credit_note_link / refund_link / document_link by type", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    const note = await seedCreditNoteForStore(store.id);
    assert.ok(note);

    const {
      issueInvoicePublicLinkForShop,
      issueCreditNotePublicLinkForShop,
    } = await import("../app/models/public-link.server");

    const invoiceLink = await issueInvoicePublicLinkForShop(
      store.shopifyDomain,
      invoice.id,
    );
    const cnLink = await issueCreditNotePublicLinkForShop(
      store.shopifyDomain,
      note!.id,
      "credit_note",
    );
    const rdLink = await issueCreditNotePublicLinkForShop(
      store.shopifyDomain,
      note!.id,
      "refund_document",
    );
    assert.ok(invoiceLink);
    assert.ok(cnLink);
    assert.ok(rdLink);
    assert.match(invoiceLink!.url, /\/public\/invoices\//);
    assert.match(cnLink!.url, /\/public\/credit-notes\//);
    assert.match(rdLink!.url, /\/public\/refund-documents\//);

    // Copy Link and Email Resolver must reuse the same Phase A URL.
    const reused = await issueInvoicePublicLinkForShop(
      store.shopifyDomain,
      invoice.id,
    );
    assert.equal(reused!.url, invoiceLink!.url);

    const calls: string[] = [];
    setDocumentEmailLinkResolver(async (args) => {
      calls.push(args.documentType);
      if (args.documentType === "tax_invoice") {
        assert.equal(args.invoiceId, invoice.id);
        return invoiceLink!.url;
      }
      assert.equal(args.creditNoteId, note!.id);
      if (args.documentType === "credit_note") return cnLink!.url;
      assert.equal(args.documentType, "refund_document");
      return rdLink!.url;
    });

    if (!hasChromium) return;

    const bodies: string[] = [];
    setResendTransportForTests(async (input) => {
      bodies.push(`${input.html || ""}\n${input.text || ""}`);
      return { ok: true, id: `re_${bodies.length}`, from: "from@test.com" };
    });

    await saveDeliverySettings(store.shopifyDomain, {
      invoiceBody: "<p>{{invoice_link}} {{document_link}}</p>",
      creditNoteBody: "<p>{{credit_note_link}} {{document_link}}</p>",
      refundBody: "<p>{{refund_link}} {{document_link}}</p>",
      showViewButton: true,
    });

    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const invSend = await sendInvoiceEmail({
      shop: store.shopifyDomain,
      invoiceId: invoice.id,
      trigger: "manual",
    });
    assert.equal(invSend.ok, true);
    assert.ok(calls.includes("tax_invoice"));
    assert.match(
      bodies.at(-1) || "",
      new RegExp(escapeRegExp(invoiceLink!.url)),
    );

    const cnSend = await sendCreditNoteEmail({
      shop: store.shopifyDomain,
      creditNoteId: note!.id,
      trigger: "manual",
    });
    assert.equal(cnSend.ok, true);
    assert.ok(calls.includes("credit_note"));
    assert.match(bodies.at(-1) || "", new RegExp(escapeRegExp(cnLink!.url)));

    const rdSend = await sendRefundDocumentEmail({
      shop: store.shopifyDomain,
      creditNoteId: note!.id,
      trigger: "manual",
    });
    assert.equal(rdSend.ok, true);
    assert.ok(calls.includes("refund_document"));
    assert.match(bodies.at(-1) || "", new RegExp(escapeRegExp(rdLink!.url)));
  });

  it("public-link failure does not break email sending", async () => {
    const { store, invoice } = await seedStoreWithInvoice();
    setDocumentEmailLinkResolver(async () => {
      throw new Error("link boom");
    });
    setResendTransportForTests(async () => ({
      ok: true,
      id: "re_no_link",
      from: "from@test.com",
    }));

    if (!hasChromium) return;

    const result = await sendInvoiceEmail({
      shop: store.shopifyDomain,
      invoiceId: invoice.id,
      trigger: "manual",
    });
    assert.equal(result.ok, true);
  });
});
