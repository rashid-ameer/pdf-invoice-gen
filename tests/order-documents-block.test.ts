/**
 * Group 15 Phase D — Documents Block pure logic + source contracts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  blockSafeErrorMessage,
  creditNotesLabel,
  documentsSummaryPath,
  invoiceCustomerLinkPath,
  invoiceEmailPath,
  invoicePreviewPath,
  numericOrderId,
  parseDocumentsSummary,
} from "../extensions/order-documents-block/src/block-extension-logic.js";

const extensionSrc = readFileSync(
  join(
    process.cwd(),
    "extensions/order-documents-block/src/BlockExtension.jsx",
  ),
  "utf8",
);

const toml = readFileSync(
  join(process.cwd(), "extensions/order-documents-block/shopify.extension.toml"),
  "utf8",
);

describe("order context", () => {
  it("reads order id from Shopify GID / numeric forms", () => {
    assert.equal(numericOrderId("gid://shopify/Order/42"), "42");
    assert.equal(numericOrderId("42"), "42");
    assert.equal(numericOrderId(null), null);
  });
});

describe("Phase B API paths", () => {
  it("builds summary, preview, email, and customer-link paths", () => {
    assert.equal(documentsSummaryPath("99"), "/app/api/orders/99/documents");
    assert.equal(
      invoiceEmailPath("99"),
      "/app/api/orders/99/invoice/email",
    );
    assert.equal(
      invoiceCustomerLinkPath("99"),
      "/app/api/orders/99/invoice/customer-link",
    );
    const preview = invoicePreviewPath("99", "tok.en");
    assert.ok(preview.startsWith("/app/api/orders/99/invoice/preview?"));
    const url = new URL(preview, "https://app.example");
    assert.equal(url.searchParams.get("token"), "tok.en");
  });
});

describe("parseDocumentsSummary", () => {
  it("maps invoice + credit note count", () => {
    const parsed = parseDocumentsSummary({
      ok: true,
      invoice: { invoiceNumber: "INV-1", status: "generated" },
      creditNotesCount: 2,
      creditNotes: [{}, {}],
    });
    assert.equal(parsed.hasInvoice, true);
    assert.equal(parsed.invoiceNumber, "INV-1");
    assert.equal(parsed.invoiceStatus, "generated");
    assert.equal(parsed.creditNotesCount, 2);
    assert.equal(creditNotesLabel(2), "2 credit notes on this order");
    assert.equal(creditNotesLabel(1), "1 credit note on this order");
    assert.equal(creditNotesLabel(0), "");
  });

  it("handles empty invoice state", () => {
    const parsed = parseDocumentsSummary({ ok: true, orderId: "1" });
    assert.equal(parsed.hasInvoice, false);
    assert.equal(parsed.ok, true);
  });
});

describe("safe errors", () => {
  it("maps auth and not-found without leaking secrets", () => {
    assert.match(blockSafeErrorMessage(401), /authenticate/i);
    assert.match(blockSafeErrorMessage(404), /invoice/i);
    assert.doesNotMatch(
      blockSafeErrorMessage(500, "Bearer eyJabc.def.shpat_x"),
      /eyJ|Bearer|shpat_/i,
    );
  });
});

describe("extension source contracts", () => {
  it("targets order details block and uses Phase B APIs", () => {
    assert.match(toml, /admin\.order-details\.block\.render/);
    assert.doesNotMatch(toml, /admin\.product-details\.block\.render/);
    assert.match(toml, /network_access\s*=\s*true/);

    assert.match(extensionSrc, /s-admin-block/);
    assert.match(extensionSrc, /documentsSummaryPath/);
    assert.match(extensionSrc, /invoiceEmailPath/);
    assert.match(extensionSrc, /invoiceCustomerLinkPath/);
    assert.match(extensionSrc, /invoicePreviewPath/);
    assert.match(extensionSrc, /shopify\.auth\?\.idToken/);
    assert.match(extensionSrc, /data\?\.selected/);
    assert.match(extensionSrc, /Authorization/);
    assert.match(extensionSrc, /printTip/);
  });

  it("does not implement render/email/public-link/download client-side", () => {
    assert.doesNotMatch(
      extensionSrc,
      /renderInvoiceDocument|sendInvoiceEmail|issueInvoicePublicLink|Resend|puppeteer|recordInvoiceDownload|HMAC|createHmac/i,
    );
    assert.doesNotMatch(extensionSrc, /buildPrintSrc|mergeDocumentHtml/);
    assert.doesNotMatch(extensionSrc, /SHOPIFY_API_SECRET|shpat_/);
  });

  it("disables email while sending and clears loading paths", () => {
    assert.match(extensionSrc, /disabled=\{sending \|\| loading\}/);
    assert.match(extensionSrc, /if \(!orderId \|\| sending\) return/);
  });
});
