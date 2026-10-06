import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Phase 3 manual email UI wiring", () => {
  it("wires invoice list Email as direct send (no modal, not details)", () => {
    const list = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    const details = readFileSync(
      join(process.cwd(), "app/routes/app.invoices_.$id.tsx"),
      "utf8",
    );

    assert.match(list, /intent", "send-email"/);
    assert.match(list, /sendInvoiceEmail/);
    assert.match(list, /trigger: "manual"/);
    assert.match(list, /const sendEmail = /);
    assert.match(list, /icon="email"/);
    assert.doesNotMatch(list, /icon="email"\s+disabled/);
    assert.doesNotMatch(list, /DocumentEmailModal|s-modal|s-email-field/);
    assert.doesNotMatch(list, /formData\.get\("to"\)|formData\.get\("templateId"\)/);
    assert.doesNotMatch(list, /listTaxInvoiceTemplatesForShop|emailTemplates/);
    assert.doesNotMatch(list, /openEmailModal|Choose a template|Email invoice/);

    assert.match(details, /Send email is not available yet/);
    assert.match(details, /disabled/);
  });

  it("wires credit note and refund document Email as direct send on the list", () => {
    const page = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(page, /sendCreditNoteEmail/);
    assert.match(page, /sendRefundDocumentEmail/);
    assert.match(page, /trigger: "manual"/);
    assert.match(page, /const sendEmail = /);
    assert.match(page, /documentType.*refund_document/);
    assert.match(page, /icon="email"/);
    assert.doesNotMatch(page, /DocumentEmailModal|s-modal|s-email-field/);
    assert.doesNotMatch(page, /formData\.get\("to"\)|formData\.get\("templateId"\)/);
    assert.doesNotMatch(page, /listCreditNoteTemplatesForShop|creditNoteTemplates/);
    assert.doesNotMatch(page, /openEmailModal|Choose a template|Email credit note|Email refund document/);

    const cnDetails = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id.tsx"),
      "utf8",
    );
    const refundDetails = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes_.$id_.refund.tsx"),
      "utf8",
    );
    assert.doesNotMatch(cnDetails, /DocumentEmailModal|sendCreditNoteEmail/);
    assert.doesNotMatch(
      refundDetails,
      /DocumentEmailModal|sendRefundDocumentEmail/,
    );
  });

  it("does not add Email to packing slips", () => {
    const packing = readFileSync(
      join(process.cwd(), "app/routes/app.packing-slips.tsx"),
      "utf8",
    );
    assert.doesNotMatch(packing, /DocumentEmailModal|send-email|Send email/);
  });

  it("removes the manual email modal component", () => {
    let exists = true;
    try {
      readFileSync(
        join(process.cwd(), "app/components/document-email-modal.tsx"),
        "utf8",
      );
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  });
});

describe("Phase 3 manual email action contracts", () => {
  it("invoice list action accepts send-email with documentId only", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.match(source, /intent === "send-email"/);
    assert.match(source, /formData.get\("documentId"\)/);
    assert.match(source, /Email sent to/);
    assert.doesNotMatch(source, /formData\.get\("to"\)/);
    assert.doesNotMatch(source, /formData\.get\("templateId"\)/);
  });

  it("credit-notes list action branches by documentType", () => {
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.match(source, /intent === "send-email"/);
    assert.match(source, /refund_document/);
    assert.match(source, /sendRefundDocumentEmail/);
    assert.match(source, /sendCreditNoteEmail/);
    assert.doesNotMatch(source, /formData\.get\("to"\)/);
    assert.doesNotMatch(source, /formData\.get\("templateId"\)/);
  });

  it("manual path does not call hasEmailSentEvent", () => {
    const invoices = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    const creditNotes = readFileSync(
      join(process.cwd(), "app/routes/app.credit-notes.tsx"),
      "utf8",
    );
    assert.doesNotMatch(invoices, /hasEmailSentEvent/);
    assert.doesNotMatch(creditNotes, /hasEmailSentEvent/);
    assert.match(invoices, /trigger: "manual"/);
    assert.match(creditNotes, /trigger: "manual"/);
  });
});
