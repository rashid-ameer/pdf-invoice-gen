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

describe("Email config page UI wiring", () => {
  it("exposes Email via Settings hub, not sidebar", () => {
    const nav = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");
    assert.doesNotMatch(nav, /href="\/app\/settings\/email"/);
    assert.doesNotMatch(nav, /href="\/app\/delivery"/);

    const settings = readFileSync(
      join(process.cwd(), "app/routes/app.settings.tsx"),
      "utf8",
    );
    assert.match(settings, /href:\s*"\/app\/settings\/email"/);
  });

  it("is configuration-only: switches, sender, recipients, and shared email layout", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email.tsx"),
      "utf8",
    );

    assert.match(page, /heading="Email"/);
    assert.match(page, /breadcrumb-actions[\s\S]*Settings/);
    assert.match(page, /Tax invoices/);
    assert.match(page, /Credit notes/);
    assert.match(page, /Refund documents/);
    assert.match(page, /Sender/);
    assert.match(page, /Recipients/);
    assert.match(page, /s-switch/);
    assert.match(page, /Send when/);
    assert.match(page, /Edit template/);
    assert.match(page, /\/app\/settings\/email\/invoice/);
    assert.match(page, /\/app\/settings\/email\/credit-note/);
    assert.match(page, /\/app\/settings\/email\/refund/);
    assert.match(page, /enabled", "1"/);
    assert.match(page, /ui-save-bar/);
    assert.match(page, /slot="aside"/);
    assert.match(page, /Sandbox mode/);
    assert.match(page, /resend\.com\/domains/);

    assert.doesNotMatch(page, /Live preview/);
    assert.doesNotMatch(page, /Email templates/);
    assert.doesNotMatch(page, /Subject line/);
    assert.doesNotMatch(page, /s-checkbox[\s\S]*Enabled|Disabled/);
    assert.doesNotMatch(page, /name=["']RESEND_API_KEY["']/);
    assert.match(page, /Email layout/);
    assert.match(page, /emailLayout/);
    assert.match(page, /Minimal: clean white layout/);
    assert.match(page, /Classic: brand-colored header bar/);
    assert.match(page, /Card: centered card on a soft background/);
  });

  it("wires edit-template route for all three types and invalid type", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email_.$type.tsx"),
      "utf8",
    );
    assert.match(page, /Tax invoice email/);
    assert.match(page, /Credit note email/);
    assert.match(page, /Refund document email/);
    assert.match(page, /EmailBodyRichTextEditor/);
    assert.match(page, /s-clickable-chip/);
    assert.match(page, /Live preview/);
    assert.match(page, /Send a test/);
    assert.match(page, /Send test/);
    assert.match(page, /showViewButton/);
    assert.match(page, /Unknown template type/);
    assert.match(page, /breadcrumb-actions/);
    assert.match(page, /previewDocumentEmail/);
    assert.match(page, /sendDocumentTestEmail/);
    assert.match(page, /insertPlaceholder/);
    assert.match(page, /Custom HTML/);
    assert.match(page, /ui-save-bar/);
    assert.match(page, /Email template/);
    assert.match(page, /Which template is sent\?/);
    assert.match(page, /s-email-field/);
    assert.match(page, /inlineSize="large"/);
    assert.match(page, /s-query-container/);
    assert.match(page, /s-grid/);
    assert.match(page, /3fr 2fr/);
    assert.doesNotMatch(page, /data-save-bar/);
    assert.doesNotMatch(page, /slot="aside"/);
    assert.doesNotMatch(page, /<details>/);
    assert.doesNotMatch(
      page,
      /bodyMode === "designed"[\s\S]*?<s-text-area[\s\S]*?label="Message"/,
    );
  });

  it("uses Quill 2 snow toolbar matching the old Delivery editor", () => {
    const editor = readFileSync(
      join(process.cwd(), "app/components/email-body-rich-text-editor.tsx"),
      "utf8",
    );
    assert.match(editor, /from "quill"/);
    assert.match(editor, /quill\.snow\.css/);
    assert.match(editor, /\["bold", "italic", "underline"\]/);
    assert.match(editor, /\["link"\]/);
    assert.match(editor, /list: "ordered"/);
    assert.match(editor, /list: "bullet"/);
    assert.match(editor, /align: \[\]/);
    assert.match(editor, /dangerouslyPasteHTML/);
    assert.match(editor, /insertText/);
    assert.doesNotMatch(editor, /image/);
  });

  it("keeps email layout on the Email page (not Branding)", () => {
    const branding = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.branding.tsx"),
      "utf8",
    );
    assert.doesNotMatch(branding, /Email layout/);
    assert.doesNotMatch(branding, /emailLayout/);
    assert.doesNotMatch(branding, /saveDeliverySettings/);
    assert.match(branding, /heading="Branding"/);

    const email = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email.tsx"),
      "utf8",
    );
    assert.match(email, /Email layout/);
    assert.match(email, /emailLayout/);
    assert.match(email, /Uses logo and colors from Branding/);
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
