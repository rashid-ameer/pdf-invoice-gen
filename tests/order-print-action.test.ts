/**
 * Group 15 Phase C — Print Action pure logic (no live Shopify Admin).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPrintSrc,
  collectPrintTypes,
  defaultPrintSelection,
  numericOrderId,
  printActionErrorMessage,
} from "../extensions/order-print/src/print-action-logic.js";

const extensionSrc = readFileSync(
  join(
    process.cwd(),
    "extensions/order-print/src/PrintActionExtension.jsx",
  ),
  "utf8",
);

describe("numericOrderId", () => {
  it("reads order id from GID and numeric forms", () => {
    assert.equal(numericOrderId("gid://shopify/Order/12345"), "12345");
    assert.equal(numericOrderId("12345"), "12345");
    assert.equal(numericOrderId(null), null);
    assert.equal(numericOrderId("abc"), null);
  });
});

describe("document type selection", () => {
  it("defaults to invoice only (old parity)", () => {
    assert.deepEqual(defaultPrintSelection(), {
      invoice: true,
      packingSlip: false,
      creditNote: false,
      refundDocument: false,
    });
    assert.deepEqual(collectPrintTypes(defaultPrintSelection()), ["invoice"]);
  });

  it("supports invoice, packing slip, credit note, refund document", () => {
    assert.deepEqual(
      collectPrintTypes({
        invoice: true,
        packingSlip: true,
        creditNote: true,
        refundDocument: true,
      }),
      ["invoice", "packing_slip", "credit_note", "refund_document"],
    );
  });

  it("preserves selection order and allows multi-select", () => {
    assert.deepEqual(
      collectPrintTypes({
        invoice: false,
        packingSlip: true,
        creditNote: false,
        refundDocument: true,
      }),
      ["packing_slip", "refund_document"],
    );
  });

  it("empty selection yields no types (blocks print)", () => {
    assert.deepEqual(
      collectPrintTypes({
        invoice: false,
        packingSlip: false,
        creditNote: false,
        refundDocument: false,
      }),
      [],
    );
    assert.equal(
      buildPrintSrc({ orderId: "1", types: [], token: "t" }),
      null,
    );
  });
});

describe("buildPrintSrc", () => {
  it("passes orderId, types, and token with encoding", () => {
    const src = buildPrintSrc({
      orderId: "999",
      types: ["invoice", "packing_slip"],
      token: "abc.def.ghi",
    });
    assert.ok(src);
    assert.ok(src!.startsWith("/app/print?"));
    const url = new URL(src!, "https://app.example");
    assert.equal(url.pathname, "/app/print");
    assert.equal(url.searchParams.get("orderId"), "999");
    assert.equal(url.searchParams.get("types"), "invoice,packing_slip");
    assert.equal(url.searchParams.get("token"), "abc.def.ghi");
  });

  it("URL-encodes special token characters", () => {
    const src = buildPrintSrc({
      orderId: "1",
      types: ["invoice"],
      token: "a+b/c=",
    });
    assert.ok(src);
    assert.match(src!, /token=a%2Bb%2Fc%3D|token=a\+b%2Fc%3D/);
    const url = new URL(src!, "https://app.example");
    assert.equal(url.searchParams.get("token"), "a+b/c=");
  });

  it("omits token param when missing (caller treats as error)", () => {
    const src = buildPrintSrc({
      orderId: "1",
      types: ["invoice"],
      token: "",
    });
    assert.ok(src);
    const url = new URL(src!, "https://app.example");
    assert.equal(url.searchParams.get("token"), null);
  });

  it("returns null without order id", () => {
    assert.equal(
      buildPrintSrc({ orderId: "", types: ["invoice"], token: "t" }),
      null,
    );
  });
});

describe("error messages", () => {
  it("never embeds secrets", () => {
    for (const code of ["no_order", "no_types", "no_token", "build_failed"]) {
      const msg = printActionErrorMessage(code);
      assert.ok(msg.length > 0);
      assert.doesNotMatch(msg, /Bearer|shpat_|eyJ|stack|password/i);
    }
  });
});

describe("extension source contracts", () => {
  it("uses s-admin-print-action and /app/print with session token", () => {
    assert.match(extensionSrc, /s-admin-print-action/);
    assert.match(extensionSrc, /buildPrintSrc/);
    assert.match(extensionSrc, /shopify\.auth\?\.idToken/);
    assert.match(extensionSrc, /data\?\.selected/);
    assert.doesNotMatch(extensionSrc, /cdn\.shopify\.com\/static\/extensibility/);
    assert.doesNotMatch(extensionSrc, /recordInvoiceDownload|\/download|puppeteer/i);
    assert.doesNotMatch(extensionSrc, /renderInvoiceDocument|sendInvoiceEmail/);
  });

  it("clears src while loading to prevent duplicate/stale print", () => {
    assert.match(extensionSrc, /setSrc\(null\)/);
    assert.match(extensionSrc, /setLoading\(true\)/);
  });
});
