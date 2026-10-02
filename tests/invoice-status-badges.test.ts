import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVOICE_DOCUMENT_STATUSES,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../app/utils/invoice-status-badges";

describe("invoice status badge tones", () => {
  it("maps payment statuses to semantic Shopify tones", () => {
    assert.equal(paymentStatusBadgeTone("paid"), "success");
    assert.equal(paymentStatusBadgeTone("pending"), "caution");
    assert.equal(paymentStatusBadgeTone("authorized"), "info");
    assert.equal(paymentStatusBadgeTone("partially_paid"), "caution");
    assert.equal(paymentStatusBadgeTone("partially_refunded"), "warning");
    assert.equal(paymentStatusBadgeTone("refunded"), "warning");
    assert.equal(paymentStatusBadgeTone("voided"), "critical");
    assert.equal(paymentStatusBadgeTone("expired"), "neutral");
    assert.equal(paymentStatusBadgeTone(""), "neutral");
  });

  it("maps invoice document statuses to semantic Shopify tones", () => {
    assert.equal(invoiceStatusBadgeTone("generated"), "success");
    assert.equal(invoiceStatusBadgeTone("downloaded"), "success");
    assert.equal(invoiceStatusBadgeTone("accepted"), "success");
    assert.equal(invoiceStatusBadgeTone("delivered"), "success");
    assert.equal(invoiceStatusBadgeTone("draft"), "neutral");
    assert.equal(invoiceStatusBadgeTone("ready"), "info");
    assert.equal(invoiceStatusBadgeTone("submitted"), "info");
    assert.equal(invoiceStatusBadgeTone("pending"), "caution");
    assert.equal(invoiceStatusBadgeTone("rejected"), "critical");
    assert.equal(invoiceStatusBadgeTone("failed"), "critical");
  });

  it("covers every known Invoice.status value", () => {
    for (const status of INVOICE_DOCUMENT_STATUSES) {
      assert.ok(invoiceStatusBadgeTone(status));
    }
  });
});
