import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  getDeliverySettings,
  normalizeDeliverySettings,
  saveDeliverySettings,
} from "../app/models/document-email.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `delivery-ui-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return store;
}

describe("Delivery page UI wiring", () => {
  it("adds Email nav to /app/delivery without duplicating existing items", () => {
    const nav = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");
    assert.match(nav, /href="\/app\/delivery">Email</);
    assert.match(nav, /href="\/app\/invoices"/);
    assert.match(nav, /href="\/app\/packing-slips"/);
    assert.match(nav, /href="\/app\/credit-notes"/);
    assert.equal((nav.match(/href="\/app\/delivery"/g) || []).length, 1);
  });

  it("renders Polaris settings sections matching old Delivery structure", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.delivery.tsx"),
      "utf8",
    );

    assert.match(page, /heading="Email"/);
    assert.match(page, /Automated emails/);
    assert.match(page, /Tax invoices/);
    assert.match(page, /Credit notes/);
    assert.match(page, /Refund documents/);
    assert.match(page, /Email templates/);
    assert.match(page, /Sender/);
    assert.match(page, /Recipients/);
    assert.match(page, /Live preview/);
    assert.match(page, /Send test/);

    assert.match(page, /s-page/);
    assert.match(page, /s-section/);
    assert.match(page, /s-checkbox/);
    assert.match(page, /s-select/);
    assert.match(page, /s-choice-list/);
    assert.match(page, /s-text-field/);
    assert.match(page, /s-email-field/);
    assert.match(page, /s-text-area/);
    assert.match(page, /s-banner/);
    assert.match(page, /ui-save-bar/);

    assert.match(page, /When order is paid/);
    assert.match(page, /When invoice is created/);
    assert.match(page, /Minimal/);
    assert.match(page, /Classic/);
    assert.match(page, /Card/);
    assert.match(page, /Show “View document” button/);
    assert.match(page, /From name/);
    assert.match(page, /Reply-to/);
    assert.match(page, /CC staff/);
    assert.match(page, /Subject line/);
    assert.match(page, /custom_html/);
    assert.match(page, /Designed/);
    assert.match(page, /Auto-send/);
    assert.match(page, /invoiceWhen/);
    assert.match(page, /showViewButton/);
    assert.match(page, /testTo/);

    assert.match(page, /getDeliverySettings/);
    assert.match(page, /saveDeliverySettings/);
    assert.match(page, /previewDocumentEmail/);
    assert.match(page, /sendDocumentTestEmail/);
    assert.match(page, /settingsFromFormData/);

    assert.doesNotMatch(page, /Packing [Ss]lip.*[Aa]uto/);
    assert.doesNotMatch(page, /name=["']RESEND_API_KEY["']/);
    assert.doesNotMatch(page, /scheduleInvoiceAutoEmail/);
    assert.doesNotMatch(page, /sendInvoiceEmail\(/);
  });
});

describe("Delivery settings UI persistence", () => {
  it("loads defaults matching old Delivery page", async () => {
    const store = await seedStore();
    const defaults = await getDeliverySettings(store.shopifyDomain);
    assert.ok(defaults);
    assert.equal(defaults!.enabled, false);
    assert.equal(defaults!.invoiceAutoSend, false);
    assert.equal(defaults!.invoiceWhen, "paid");
    assert.equal(defaults!.creditNoteAutoSend, false);
    assert.equal(defaults!.refundDocumentAutoSend, false);
    assert.equal(defaults!.emailLayout, "classic");
    assert.equal(defaults!.showViewButton, true);
    assert.equal(defaults!.invoiceBodyMode, "designed");
    assert.equal(defaults!.creditNoteBodyMode, "designed");
    assert.equal(defaults!.refundBodyMode, "designed");
  });

  it("saves master, automation, sender, CC, layout, and document email content", async () => {
    const store = await seedStore();
    const partial = normalizeDeliverySettings({
      enabled: true,
      invoiceAutoSend: true,
      invoiceWhen: "paid",
      creditNoteAutoSend: true,
      refundDocumentAutoSend: false,
      ccStaff: "ops@example.com",
      fromName: "Store From",
      replyTo: "hello@example.com",
      emailLayout: "card",
      showViewButton: false,
      invoiceBodyMode: "custom_html",
      invoiceSubject: "Tax {{invoice_number}}",
      invoiceBody: "<p>designed</p>",
      invoiceBodyCustom: "<p>custom invoice</p>",
      creditNoteBodyMode: "designed",
      creditNoteSubject: "CN {{credit_note_number}}",
      creditNoteBody: "<p>cn body</p>",
      creditNoteBodyCustom: "",
      refundBodyMode: "designed",
      refundSubject: "RD {{order_number}}",
      refundBody: "<p>rd</p>",
      refundBodyCustom: "",
    });

    const saved = await saveDeliverySettings(store.shopifyDomain, partial);
    assert.ok(saved);
    assert.equal(saved!.enabled, true);
    assert.equal(saved!.invoiceAutoSend, true);
    assert.equal(saved!.invoiceWhen, "paid");
    assert.equal(saved!.creditNoteAutoSend, true);
    assert.equal(saved!.refundDocumentAutoSend, false);
    assert.equal(saved!.fromName, "Store From");
    assert.equal(saved!.replyTo, "hello@example.com");
    assert.equal(saved!.ccStaff, "ops@example.com");
    assert.equal(saved!.emailLayout, "card");
    assert.equal(saved!.showViewButton, false);
    assert.equal(saved!.invoiceBodyMode, "custom_html");
    assert.equal(saved!.invoiceBodyCustom, "<p>custom invoice</p>");
    assert.equal(saved!.creditNoteSubject, "CN {{credit_note_number}}");
    assert.equal(saved!.refundBody, "<p>rd</p>");

    const again = await getDeliverySettings(store.shopifyDomain);
    assert.equal(again!.emailLayout, "card");
    assert.equal(again!.invoiceSubject, "Tax {{invoice_number}}");
    assert.equal(again!.showViewButton, false);
    assert.equal(again!.enabled, true);
  });

  it("accepts created timing and designed/custom modes for all document kinds", async () => {
    const store = await seedStore();
    const saved = await saveDeliverySettings(store.shopifyDomain, {
      invoiceWhen: "created",
      invoiceBodyMode: "designed",
      creditNoteBodyMode: "custom_html",
      refundBodyMode: "custom_html",
      creditNoteBodyCustom: "<html>cn</html>",
      refundBodyCustom: "<p>rd custom</p>",
      emailLayout: "minimal",
    });
    assert.ok(saved);
    assert.equal(saved!.invoiceWhen, "created");
    assert.equal(saved!.emailLayout, "minimal");
    assert.equal(saved!.creditNoteBodyMode, "custom_html");
    assert.equal(saved!.creditNoteBodyCustom, "<html>cn</html>");
    assert.equal(saved!.refundBodyMode, "custom_html");
    assert.equal(saved!.refundBodyCustom, "<p>rd custom</p>");
  });
});
