import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  barcodeSourceForLine,
  generateBarcodeDataUrl,
  isBarcodeScannable,
} from "../app/models/barcode-image.server";
import {
  inlineProductImageUrl,
  sanitizeProductImageUrl,
} from "../app/models/line-item-image.server";
import {
  meaningfulVariantTitle,
  prepareLineItemsForRender,
  usesRichLineProductCell,
} from "../app/models/line-item-render.server";
import {
  clearPdfMemoryCacheForTests,
  hashContent,
} from "../app/models/pdf-memory-cache.server";
import {
  cachedHtmlToPdfBuffer,
  pdfCacheKeyForHtml,
} from "../app/models/pdf-cache.server";
import {
  renderDocumentHtml,
  renderDocumentPdf,
  sampleRenderDataForDocumentType,
} from "../app/models/render.server";
import { applyA4DocumentLayout } from "../app/models/document-preview.server";
import { getDefaultConfigForLayout } from "../app/models/template-config.defaults";
import { BASE_LAYOUT_CODES } from "../app/models/template-config.types";
import type { DocumentType } from "../app/types/index";

function chromiumAvailable(): boolean {
  return Boolean(
    process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_PATH ||
      process.env.RUN_PDF_SMOKE === "1",
  );
}

describe("line-item images", () => {
  it("sanitizes allowed data URLs and Shopify CDN https hosts", () => {
    assert.match(
      sanitizeProductImageUrl(
        "data:image/png;base64,aaa",
      ),
      /^data:image\/png/,
    );
    assert.equal(
      sanitizeProductImageUrl("https://cdn.shopify.com/s/files/1/x.png"),
      "https://cdn.shopify.com/s/files/1/x.png",
    );
    assert.equal(sanitizeProductImageUrl("http://evil.example/a.png"), "");
    assert.equal(sanitizeProductImageUrl("https://evil.example/a.png"), "");
  });

  it("returns data URLs as-is from inlineProductImageUrl", async () => {
    const data =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    assert.equal(await inlineProductImageUrl(data), data);
    assert.equal(await inlineProductImageUrl(""), undefined);
  });
});

describe("barcodes", () => {
  it("validates Code128-safe values and ignores SKU fallbacks", () => {
    assert.equal(isBarcodeScannable("6291108734612"), true);
    assert.equal(isBarcodeScannable(""), false);
    assert.equal(barcodeSourceForLine({ barcode: "ABC-123" }), "ABC-123");
    assert.equal(barcodeSourceForLine({ barcode: "  " }), null);
  });

  it("generates a PNG data URL for a scannable barcode", async () => {
    const url = await generateBarcodeDataUrl("6291108734612");
    assert.ok(url);
    assert.match(url!, /^data:image\/png;base64,/);
  });
});

describe("prepareLineItemsForRender", () => {
  it("strips Default Title and builds rich description HTML", async () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    assert.equal(usesRichLineProductCell(config), true);
    assert.equal(meaningfulVariantTitle("Default Title"), "");
    assert.equal(meaningfulVariantTitle("Large / Blue"), "Large / Blue");

    const prepared = await prepareLineItemsForRender(
      [
        {
          description: "Widget — Default Title",
          productTitle: "Widget — Default Title",
          variantTitle: "Default Title",
          quantity: 1,
          unitPrice: "10.00",
          discount: "0%",
          vatRate: "5%",
          vatAmount: "0.50",
          lineTotal: "10.50",
          barcode: "6291108734612",
          imageUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      ],
      config,
    );
    assert.ok(prepared[0].descriptionHtml);
    assert.match(prepared[0].descriptionHtml!, /line-product-title/);
    assert.doesNotMatch(prepared[0].descriptionHtml!, /Default Title/);
    assert.ok(prepared[0].barcodeDataUrl?.startsWith("data:image/png"));
  });
});

describe("HTML render parity", () => {
  const docTypes: DocumentType[] = [
    "tax_invoice",
    "packing_slip",
    "credit_note",
    "refund_document",
  ];

  for (const documentType of docTypes) {
    it(`renders ${documentType} with modern layout`, async () => {
      const html = await renderDocumentHtml({
        baseLayoutCode: "modern",
        documentType,
        data: sampleRenderDataForDocumentType(documentType),
        skipLinePrep: true,
      });
      assert.match(html, /<!DOCTYPE html>/i);
      assert.match(html, /<body>/i);
      if (documentType === "packing_slip") {
        assert.match(html, /PACKING SLIP/i);
        // Packing slip totals section hidden by default config
        assert.equal(html.includes("Grand Total") || html.includes("Total due"), false);
      }
      if (documentType === "credit_note") {
        assert.match(html, /CREDIT NOTE/i);
      }
      if (documentType === "refund_document") {
        assert.match(html, /REFUND DOCUMENT/i);
      }
      if (documentType === "tax_invoice") {
        assert.match(html, /TAX INVOICE|Invoice/i);
      }
    });
  }

  it("escapes dangerous text in seller name", async () => {
    const data = sampleRenderDataForDocumentType("tax_invoice");
    data.seller.legalName = `<script>alert(1)</script>`;
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      data,
      skipLinePrep: true,
    });
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.match(html, /&lt;script&gt;/);
  });

  it("applies branding colors into CSS variables", async () => {
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: {
        primaryColor: "#112233",
        secondaryColor: "#445566",
        accentColor: "#778899",
        logoUrl: "",
        footerText: "Thanks from brand",
      },
      skipLinePrep: true,
    });
    assert.match(html, /#112233/i);
    assert.match(html, /Thanks from brand/);
  });

  it("renders each system layout for tax_invoice without throwing", async () => {
    for (const layout of BASE_LAYOUT_CODES) {
      const html = await renderDocumentHtml({
        baseLayoutCode: layout,
        documentType: "tax_invoice",
        data: sampleRenderDataForDocumentType("tax_invoice"),
        skipLinePrep: true,
      });
      assert.match(html, /<!DOCTYPE html>/i, layout);
    }
  });

  it("wraps HTML with A4 page styles", async () => {
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      data: sampleRenderDataForDocumentType("tax_invoice"),
      skipLinePrep: true,
    });
    const a4 = applyA4DocumentLayout(html);
    assert.match(a4, /size:\s*A4/);
    assert.match(a4, /210mm/);
  });
});

describe("PDF memory cache keys", () => {
  it("uses sha256 content keys and differentiates HTML", () => {
    clearPdfMemoryCacheForTests();
    const a = pdfCacheKeyForHtml("<html>a</html>");
    const b = pdfCacheKeyForHtml("<html>b</html>");
    const a2 = pdfCacheKeyForHtml("<html>a</html>");
    assert.equal(a, a2);
    assert.notEqual(a, b);
    assert.equal(hashContent("x").length, 64);
  });
});

describe("PDF smoke", () => {
  it("generates a PDF buffer when Chromium is available", async (t) => {
    if (!chromiumAvailable()) {
      t.skip(
        "Chromium not configured — set PUPPETEER_EXECUTABLE_PATH, CHROME_PATH, or RUN_PDF_SMOKE=1",
      );
      return;
    }
    clearPdfMemoryCacheForTests();
    const pdf = await renderDocumentPdf({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      data: sampleRenderDataForDocumentType("tax_invoice"),
      skipLinePrep: true,
    });
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 4).toString("utf8"), "%PDF");

    const again = await cachedHtmlToPdfBuffer(
      applyA4DocumentLayout(
        await renderDocumentHtml({
          baseLayoutCode: "modern",
          documentType: "tax_invoice",
          data: sampleRenderDataForDocumentType("tax_invoice"),
          skipLinePrep: true,
        }),
      ),
    );
    // Second call may hit cache depending on exact HTML equality from re-render
    assert.ok(again.length > 1000);
  });
});
