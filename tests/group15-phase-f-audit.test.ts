/**
 * Group 15 Phase F — integration/security audit contracts (no live Shopify Admin).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const routeFiles = [
  "app/routes/app_.print.tsx",
  "app/routes/app_.api.orders.$orderId.documents.tsx",
  "app/routes/app_.api.orders.$orderId.invoice.preview.tsx",
  "app/routes/app_.api.orders.$orderId.invoice.email.tsx",
  "app/routes/app_.api.orders.$orderId.invoice.customer-link.tsx",
];

const extensionTomls = [
  "extensions/order-print/shopify.extension.toml",
  "extensions/order-documents-block/shopify.extension.toml",
  "extensions/order-documents-action/shopify.extension.toml",
];

describe("Phase F — route auth + shop binding", () => {
  it("every G15 resource route uses handleExtensionResource and ctx.shop", () => {
    for (const file of routeFiles) {
      const src = read(file);
      assert.match(src, /handleExtensionResource/, file);
      assert.match(src, /ctx\.shop/, file);
      // No App Home session auth import/call (comments alone are fine).
      assert.doesNotMatch(src, /from ["'].*shopify\.server["']/, file);
      assert.doesNotMatch(src, /\bauthenticate\.admin\s*\(/, file);
      assert.doesNotMatch(
        src,
        /searchParams\.get\(["']shop["']\)|body\.shop|params\.shop/,
        file,
      );
    }
  });

  it("order-documents service scopes by shopDomain and does not record downloads", () => {
    const src = read("app/models/order-documents.server.ts");
    assert.match(src, /shopifyDomain: shopDomain/);
    assert.match(src, /sendInvoiceEmail/);
    assert.match(src, /trigger:\s*"manual"/);
    assert.match(src, /issueInvoicePublicLinkForShop/);
    assert.match(src, /renderInvoiceDocument/);
    assert.match(src, /renderPackingSlipDocument/);
    assert.match(src, /renderCreditNoteDocument/);
    assert.match(src, /renderRefundDocument/);
    assert.match(src, /mergeDocumentHtml/);
    assert.doesNotMatch(src, /recordInvoiceDownload|recordPackingSlipDownload/);
    assert.doesNotMatch(src, /recordCreditNoteDownload|recordRefundDocumentDownload/);
  });

  it("Phase A auth derives shop from token dest only", () => {
    const src = read("app/models/extension-auth.server.ts");
    assert.match(src, /payload\.dest/);
    assert.match(src, /sanitizeShop/);
    assert.match(src, /Missing session token/);
    assert.match(src, /Invalid session token/);
    assert.doesNotMatch(src, /searchParams\.get\(["']shop["']\)/);
  });
});

describe("Phase F — extension configuration", () => {
  it("targets order-details surfaces with expected capabilities", () => {
    const print = read(extensionTomls[0]);
    const block = read(extensionTomls[1]);
    const action = read(extensionTomls[2]);

    assert.match(print, /admin\.order-details\.print-action\.render/);
    assert.match(print, /api_access\s*=\s*true/);
    assert.doesNotMatch(print, /network_access/); // print uses src iframe, no fetch

    assert.match(block, /admin\.order-details\.block\.render/);
    assert.match(block, /api_access\s*=\s*true/);
    assert.match(block, /network_access\s*=\s*true/);

    assert.match(action, /admin\.order-details\.action\.render/);
    assert.match(action, /api_access\s*=\s*true/);
    assert.match(action, /network_access\s*=\s*true/);

    for (const file of extensionTomls) {
      const src = read(file);
      assert.doesNotMatch(src, /product-details/);
      assert.doesNotMatch(src, /SHOPIFY_API_SECRET|shpat_|eyJ/);
    }
  });

  it("extensions do not embed duplicate engines or secrets", () => {
    const files = [
      "extensions/order-print/src/PrintActionExtension.jsx",
      "extensions/order-documents-block/src/BlockExtension.jsx",
      "extensions/order-documents-action/src/ActionExtension.jsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.match(src, /shopify\.auth\?\.idToken|shopify\.auth\.idToken/);
      assert.doesNotMatch(
        src,
        /Resend|createHmac|puppeteer|renderInvoiceDocument|sendInvoiceEmail|issueInvoicePublicLink|SHOPIFY_API_SECRET|shpat_/i,
        file,
      );
      assert.doesNotMatch(src, /cdn\.shopify\.com\/static\/extensibility/, file);
    }
  });
});

describe("Phase F — G15 test surface present", () => {
  it("includes dedicated Phase A–E test files", () => {
    const tests = readdirSync(join(root, "tests"));
    for (const name of [
      "extension-auth.test.ts",
      "order-documents.test.ts",
      "order-print-action.test.ts",
      "order-documents-block.test.ts",
      "order-documents-action.test.ts",
    ]) {
      assert.ok(tests.includes(name), name);
    }
  });
});
