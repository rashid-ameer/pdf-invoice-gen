/**
 * Group 15 Phase E — Order Action pure logic + source contracts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OPEN_INVOICES_HREF,
  actionSafeErrorMessage,
  buildOrderActionPrintHref,
  creditNotesLabel,
  documentsSummaryPath,
  invoiceCustomerLinkPath,
  invoiceEmailPath,
  invoicePreviewImagePath,
  numericOrderId,
  parseDocumentsSummary,
} from "../extensions/order-documents-action/src/action-extension-logic.js";

const extensionSrc = readFileSync(
  join(
    process.cwd(),
    "extensions/order-documents-action/src/ActionExtension.jsx",
  ),
  "utf8",
);

const toml = readFileSync(
  join(
    process.cwd(),
    "extensions/order-documents-action/shopify.extension.toml",
  ),
  "utf8",
);

describe("order context", () => {
  it("uses selected Shopify order id only", () => {
    assert.equal(numericOrderId("gid://shopify/Order/88"), "88");
    assert.equal(numericOrderId("88"), "88");
    assert.equal(numericOrderId(null), null);
  });
});

describe("API reuse", () => {
  it("points email/customer-link/summary/preview at Phase B paths", () => {
    assert.equal(documentsSummaryPath("7"), "/app/api/orders/7/documents");
    assert.equal(invoiceEmailPath("7"), "/app/api/orders/7/invoice/email");
    assert.equal(
      invoiceCustomerLinkPath("7"),
      "/app/api/orders/7/invoice/customer-link",
    );
    const preview = invoicePreviewImagePath("7", "abc.def");
    assert.match(preview, /\/app\/api\/orders\/7\/invoice\/preview-image\?/);
    assert.equal(
      new URL(preview, "https://x").searchParams.get("token"),
      "abc.def",
    );
  });

  it("builds /app/print with orderId, types=invoice, token", () => {
    const href = buildOrderActionPrintHref({
      orderId: "55",
      token: "tok.en",
      types: ["invoice"],
    });
    assert.ok(href);
    const url = new URL(href!, "https://app.example");
    assert.equal(url.pathname, "/app/print");
    assert.equal(url.searchParams.get("orderId"), "55");
    assert.equal(url.searchParams.get("types"), "invoice");
    assert.equal(url.searchParams.get("token"), "tok.en");
  });

  it("defaults print types to invoice when omitted", () => {
    const href = buildOrderActionPrintHref({ orderId: "1", token: "t" });
    assert.equal(
      new URL(href!, "https://app.example").searchParams.get("types"),
      "invoice",
    );
  });
});

describe("summary parsing", () => {
  it("maps invoice fields and credit note count", () => {
    const parsed = parseDocumentsSummary({
      ok: true,
      invoice: {
        invoiceNumber: "INV-9",
        status: "generated",
        orderNumber: "#1001",
      },
      creditNotesCount: 1,
    });
    assert.equal(parsed.hasInvoice, true);
    assert.equal(parsed.orderNumber, "#1001");
    assert.equal(creditNotesLabel(1), "1 credit note on this order");
  });
});

describe("safe errors / open in app", () => {
  it("never leaks secrets and opens invoices list route", () => {
    assert.match(actionSafeErrorMessage(401), /authenticate/i);
    assert.doesNotMatch(
      actionSafeErrorMessage(500, "Bearer eyJxxx.shpat_y"),
      /eyJ|Bearer|shpat_/i,
    );
    assert.equal(OPEN_INVOICES_HREF, "app://app/invoices");
  });
});

describe("extension source contracts", () => {
  it("targets order-details action and wires Phase B APIs", () => {
    assert.match(toml, /admin\.order-details\.action\.render/);
    assert.doesNotMatch(toml, /admin\.product-details\.action\.render/);
    assert.match(toml, /network_access\s*=\s*true/);

    assert.match(extensionSrc, /s-admin-action/);
    assert.match(extensionSrc, /shopify\.auth\?\.idToken/);
    assert.match(extensionSrc, /Authorization/);
    assert.match(extensionSrc, /data\?\.selected/);
    assert.match(extensionSrc, /invoiceEmailPath/);
    assert.match(extensionSrc, /invoiceCustomerLinkPath/);
    assert.match(extensionSrc, /invoicePreviewImagePath/);
    assert.match(extensionSrc, /loadInvoicePreviewDataUrl/);
    assert.match(extensionSrc, /s-image/);
    assert.match(extensionSrc, /previewSrc/);
    assert.match(extensionSrc, /buildOrderActionPrintHref/);
    assert.match(extensionSrc, /OPEN_INVOICES_HREF/);
    assert.match(extensionSrc, /types:\s*\["invoice"\]/);
  });

  it("primary action is email; loading prevents duplicates", () => {
    assert.match(extensionSrc, /slot="primary-action"/);
    assert.match(extensionSrc, /onEmail/);
    assert.match(
      extensionSrc,
      /disabled=\{sending \|\| loading \|\| !hasInvoice\}/,
    );
    assert.match(
      extensionSrc,
      /if \(!orderId \|\| sending \|\| loading \|\| !hasInvoice\) return/,
    );
  });

  it("does not embed render/email/token engines or trust client shop", () => {
    assert.doesNotMatch(
      extensionSrc,
      /renderInvoiceDocument|sendInvoiceEmail|issueInvoicePublicLink|Resend|createHmac|puppeteer|recordInvoiceDownload/i,
    );
    assert.doesNotMatch(extensionSrc, /SHOPIFY_API_SECRET|shpat_/);
    assert.doesNotMatch(extensionSrc, /body\.shop|params\.shop|storeId/);
  });
});
