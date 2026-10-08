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
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return store;
}

describe("Email hub UI wiring", () => {
  it("exposes Email via Settings hub, not sidebar", () => {
    const nav = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");
    assert.doesNotMatch(nav, /href="\/app\/settings\/email"/);
    assert.doesNotMatch(nav, /href="\/app\/delivery"/);

    const settings = readFileSync(
      join(process.cwd(), "app/routes/app.settings.tsx"),
      "utf8",
    );
    assert.match(settings, /href:\s*"\/app\/settings\/email"/);
    assert.match(settings, /SettingsNavRow/);
  });

  it("is a hub with three rows matching Settings hub structure", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email.tsx"),
      "utf8",
    );

    assert.match(page, /heading="Email"/);
    assert.match(page, /breadcrumb-actions[\s\S]*Settings/);
    assert.match(page, /Choose an email setting/);
    assert.match(page, /SettingsNavRow/);
    assert.match(page, /EmailSandboxBanner/);
    assert.match(page, /Automated emails/);
    assert.match(page, /Sender and recipients/);
    assert.match(page, /Email templates/);
    assert.match(page, /\/app\/settings\/email\/automated-emails/);
    assert.match(page, /\/app\/settings\/email\/sender-recipients/);
    assert.match(page, /\/app\/settings\/email\/templates/);
    assert.match(page, /Sandbox mode|EmailSandboxBanner/);

    assert.doesNotMatch(page, /s-switch/);
    assert.doesNotMatch(page, /Edit template/);
    assert.doesNotMatch(page, /Minimal: clean white layout/);
    assert.doesNotMatch(page, /slot="aside"/);
    assert.doesNotMatch(page, /From name/);
  });

  it("wires Automated emails page with toggles only", () => {
    const page = readFileSync(
      join(
        process.cwd(),
        "app/routes/app.settings_.email_.automated-emails.tsx",
      ),
      "utf8",
    );
    assert.match(page, /heading="Automated emails"/);
    assert.match(page, /SettingsEmailBreadcrumbs/);
    assert.match(page, /Tax invoices/);
    assert.match(page, /Credit notes/);
    assert.match(page, /Refund documents/);
    assert.match(page, /s-switch/);
    assert.match(page, /Send when/);
    assert.match(page, /ui-save-bar/);
    assert.match(page, /saveDeliverySettings/);
    assert.doesNotMatch(page, /Edit template/);
    assert.doesNotMatch(page, /From name/);
    assert.doesNotMatch(page, /EmailSandboxBanner/);
    assert.doesNotMatch(page, /emailLayout/);
  });

  it("wires Sender and recipients page with fields and sandbox banner", () => {
    const page = readFileSync(
      join(
        process.cwd(),
        "app/routes/app.settings_.email_.sender-recipients.tsx",
      ),
      "utf8",
    );
    assert.match(page, /heading="Sender and recipients"/);
    assert.match(page, /SettingsEmailBreadcrumbs/);
    assert.match(page, /From name/);
    assert.match(page, /Reply-to/);
    assert.match(page, /CC staff/);
    assert.match(page, /EmailSandboxBanner/);
    assert.match(page, /ui-save-bar/);
    assert.match(page, /saveDeliverySettings/);
    assert.doesNotMatch(page, /s-switch/);
    assert.doesNotMatch(page, /emailLayout/);
  });

  it("wires Email templates list page to existing editors", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email_.templates.tsx"),
      "utf8",
    );
    assert.match(page, /heading="Email templates"/);
    assert.match(page, /SettingsEmailBreadcrumbs/);
    assert.match(page, /Tax invoice email/);
    assert.match(page, /Credit note email/);
    assert.match(page, /Refund document email/);
    assert.match(page, /\/app\/settings\/email\/invoice/);
    assert.match(page, /\/app\/settings\/email\/credit-note/);
    assert.match(page, /\/app\/settings\/email\/refund/);
    assert.doesNotMatch(page, /ui-save-bar/);
    assert.doesNotMatch(page, /s-switch/);
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
    assert.match(page, /emailLayout/);
    assert.match(page, /Minimal/);
    assert.match(page, /Classic/);
    assert.match(page, /Card/);
    assert.match(page, /heading="Layout"/);
    assert.match(
      page,
      /bodyMode === "designed"[\s\S]*?heading="Layout"/,
    );
    assert.match(page, /Unknown template type/);
    assert.match(page, /SettingsEmailBreadcrumbs/);
    assert.match(page, /previewDocumentEmail/);
    assert.match(page, /sendDocumentTestEmail/);
    assert.match(page, /insertPlaceholder/);
    assert.match(page, /Custom HTML/);
    assert.match(page, /ui-save-bar/);
    assert.match(page, /Email template/);
    assert.match(page, /Which template is sent\?/);
    assert.match(page, /s-email-field/);
    assert.match(page, /inlineSize="base"/);
    assert.match(page, /s-query-container/);
    assert.match(page, /s-grid/);
    assert.match(page, /3fr 2fr/);
    assert.match(page, /href="\/app\/settings\/email"/);
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

  it("keeps email layout off Branding and Email hub; editor has it", () => {
    const branding = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.branding.tsx"),
      "utf8",
    );
    assert.doesNotMatch(branding, /Email layout/);
    assert.doesNotMatch(branding, /emailLayout/);
    assert.doesNotMatch(branding, /saveDeliverySettings/);
    assert.match(branding, /heading="Branding"/);

    const hub = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email.tsx"),
      "utf8",
    );
    assert.doesNotMatch(hub, /Minimal: clean white layout/);
    assert.doesNotMatch(hub, /emailLayout/);

    const editor = readFileSync(
      join(process.cwd(), "app/routes/app.settings_.email_.$type.tsx"),
      "utf8",
    );
    assert.match(editor, /emailLayout/);
    assert.match(editor, /value="minimal"/);
    assert.match(editor, /value="classic"/);
    assert.match(editor, /value="card"/);
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
  });

  it("partial save keeps other fields and layout unchanged", async () => {
    const store = await seedStore();
    await saveDeliverySettings(store.shopifyDomain, {
      emailLayout: "card",
      fromName: "Acme",
      replyTo: "ops@example.com",
      invoiceAutoSend: true,
      invoiceWhen: "created",
    });

    const afterAutomation = await saveDeliverySettings(store.shopifyDomain, {
      invoiceAutoSend: false,
      invoiceWhen: "paid",
      creditNoteAutoSend: true,
      refundDocumentAutoSend: false,
    });
    assert.ok(afterAutomation);
    assert.equal(afterAutomation!.emailLayout, "card");
    assert.equal(afterAutomation!.fromName, "Acme");
    assert.equal(afterAutomation!.replyTo, "ops@example.com");
    assert.equal(afterAutomation!.invoiceAutoSend, false);
    assert.equal(afterAutomation!.creditNoteAutoSend, true);

    const afterSender = await saveDeliverySettings(store.shopifyDomain, {
      fromName: "New Name",
      replyTo: "hello@example.com",
      ccStaff: "a@example.com",
    });
    assert.ok(afterSender);
    assert.equal(afterSender!.emailLayout, "card");
    assert.equal(afterSender!.invoiceAutoSend, false);
    assert.equal(afterSender!.creditNoteAutoSend, true);
    assert.equal(afterSender!.fromName, "New Name");
    assert.equal(afterSender!.replyTo, "hello@example.com");
  });

  it("normalizes delivery settings", () => {
    const partial = normalizeDeliverySettings({
      emailLayout: "card",
      invoiceWhen: "created",
    });
    assert.equal(partial.emailLayout, "card");
    assert.equal(partial.invoiceWhen, "created");

    const again = normalizeDeliverySettings({
      emailLayout: "nope",
    });
    assert.equal(again.emailLayout, "classic");
  });
});
