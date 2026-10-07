/**
 * Group 14 Phase C — Liquid validate, sync, render, isolation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  createCustomTemplate,
  ensureSystemTemplates,
  getTemplateByIdForShop,
  getTemplateLiquidSourceForShop,
  previewTemplateVisualConfig,
  resolveTemplateForShop,
  saveTemplateAsNew,
  saveTemplateConfig,
  setDefaultTemplate,
  syncConfigToLiquidForShop,
  validateTemplateLiquidForShop,
  blockingLiquidErrorsForEditor,
} from "../app/models/template.server";
import {
  renderLiquidTemplate,
  validateLiquidSource,
  starterLiquidFor,
  buildLiquidFromConfig,
} from "../app/models/template-liquid.server";
import { applyConfigToExistingLiquid } from "../app/models/template-liquid-sync.server";
import { extractVisualConfigFromLiquid } from "../app/models/template-liquid-extract";
import { getDefaultConfigForLayout } from "../app/models/template-config.defaults";
import {
  renderDocumentHtml,
  sampleRenderDataForDocumentType,
} from "../app/models/render.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

before(async () => {
  await ensureSystemTemplates();
});

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceTemplate.deleteMany({
      where: { storeId: row.storeId, isSystem: false },
    });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore(prefix = "liq") {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `${prefix}-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

const VALID_INVOICE_LIQUID = `
<!DOCTYPE html><html><body>
<h1>{{ document.title }}</h1>
<p>{{ invoice.number }} / {{ seller.trn }} / {{ seller.legal_name }}</p>
{% for item in line_items %}
  <div>{{ item.description }} {{ item.quantity }} {{ item.line_total }} {{ item.vat_rate }}</div>
{% endfor %}
<p>{{ totals.vat_total }} {{ totals.grand_total }}</p>
{{ qr_html }}
</body></html>
`.trim();

describe("Group 14 Phase C — Liquid validation", () => {
  it("accepts Liquid the old app accepts", () => {
    const check = validateLiquidSource(VALID_INVOICE_LIQUID, "tax_invoice");
    assert.equal(check.errors.length, 0);
  });

  it("rejects empty / too-large / syntax / missing required fields", () => {
    assert.ok(validateLiquidSource("", "tax_invoice").errors.length > 0);
    assert.ok(
      validateLiquidSource("{% if %}", "tax_invoice").errors.some((e) =>
        /syntax|Liquid/i.test(e),
      ),
    );
    const missing = validateLiquidSource(
      "<html><body>hello</body></html>",
      "tax_invoice",
    );
    assert.ok(missing.errors.some((e) => /invoice\.number|Document number/i.test(e)));
    assert.ok(missing.errors.some((e) => /seller\.trn|TRN/i.test(e)));
    assert.ok(missing.errors.some((e) => /line_items|Line items/i.test(e)));
  });

  it("code editor mode only blocks syntax/markup/empty/size errors", () => {
    const check = validateLiquidSource(
      "<html><body>hello</body></html>",
      "tax_invoice",
    );
    assert.ok(check.errors.length > 0);
    assert.equal(blockingLiquidErrorsForEditor(check, "code").length, 0);
    assert.ok(blockingLiquidErrorsForEditor(check, "visual").length > 0);
  });
});

describe("Group 14 Phase C — save / reject / load", () => {
  it("valid Liquid saves; invalid rejects without corrupting source", async () => {
    const { store } = await seedStore("save");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Liquid custom",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.ok(created);

    const before = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(before!.template.sourceType, "code");
    assert.match(String(before!.template.customHtml), /invoice\.number/);

    const invalid = await validateTemplateLiquidForShop(
      store.shopifyDomain,
      created!.id,
      "{% broken",
    );
    assert.ok(invalid);
    assert.ok(invalid!.errors.length > 0);

    // Simulate route reject: do not call saveTemplateConfig when invalid.
    const still = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(still!.template.customHtml, before!.template.customHtml);

    const updated = await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: before!.config,
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID.replace(
        "document.title",
        "document.title",
      ) + "\n<!-- ok -->",
      customCss: ".x{color:red}",
    });
    assert.ok(updated);
    const after = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.match(String(after!.template.customHtml), /<!-- ok -->/);
    assert.equal(after!.template.customCss, ".x{color:red}");
  });

  it("loads Liquid source for shop; foreign denied", async () => {
    const a = await seedStore("srca");
    const b = await seedStore("srcb");
    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Src",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.ok(created);

    const source = await getTemplateLiquidSourceForShop(
      a.store.shopifyDomain,
      created!.id,
    );
    assert.ok(source);
    assert.match(source!.liquidHtml, /invoice\.number/);

    const foreign = await getTemplateLiquidSourceForShop(
      b.store.shopifyDomain,
      created!.id,
    );
    assert.equal(foreign, null);

    const foreignValidate = await validateTemplateLiquidForShop(
      b.store.shopifyDomain,
      created!.id,
      VALID_INVOICE_LIQUID,
    );
    assert.equal(foreignValidate, null);
  });

  it("system templates remain immutable via saveTemplateConfig", async () => {
    const { store } = await seedStore("sys");
    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(system);
    const denied = await saveTemplateConfig(store.shopifyDomain, system!.id, {
      config: {},
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.equal(denied, null);
  });
});

describe("Group 14 Phase C — config → Liquid sync", () => {
  it("applyConfigToExistingLiquid patches changed groups only", () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const base = buildLiquidFromConfig(config, "tax_invoice");
    const next = structuredClone(config);
    next.branding.primaryColor = "#FF00AA";
    const patched = applyConfigToExistingLiquid(base, next, "tax_invoice", config);
    assert.match(patched, /#FF00AA/i);
    assert.notEqual(patched, base);
  });

  it("syncConfigToLiquidForShop is store-scoped", async () => {
    const a = await seedStore("synca");
    const b = await seedStore("syncb");
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const liquid = buildLiquidFromConfig(config, "tax_invoice");
    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Sync",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: liquid,
    });
    assert.ok(created);
    const loaded = await getTemplateByIdForShop(
      a.store.shopifyDomain,
      created!.id,
    );
    const next = structuredClone(loaded!.config);
    next.branding.primaryColor = "#ABCDEF";

    const synced = await syncConfigToLiquidForShop(
      a.store.shopifyDomain,
      created!.id,
      {
        config: next,
        previousConfig: loaded!.config,
        liquidHtml: String(loaded!.template.customHtml),
      },
    );
    assert.ok(synced);
    // Old sync only patches existing color tokens — starter Liquid includes them.
    assert.match(synced!.liquidHtml, /#ABCDEF/i);

    const foreign = await syncConfigToLiquidForShop(
      b.store.shopifyDomain,
      created!.id,
      { config: next, liquidHtml: liquid },
    );
    assert.equal(foreign, null);

    // Minimal Liquid without color selectors: sync leaves source alone (old parity).
    const minimal = await syncConfigToLiquidForShop(
      a.store.shopifyDomain,
      created!.id,
      {
        config: next,
        previousConfig: loaded!.config,
        liquidHtml: VALID_INVOICE_LIQUID,
      },
    );
    assert.ok(minimal);
    assert.doesNotMatch(minimal!.liquidHtml, /#ABCDEF/i);
  });
});

describe("Group 14 Phase C — Liquid → config extraction", () => {
  it("extracts column / totals / QR hints from Liquid (old applyCodeToForm)", () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const liquid = `
      {% for item in line_items %}
        {{ item.sku }} {{ item.quantity }} {{ item.unit_price }}
      {% endfor %}
      {{ totals.subtotal }} {{ totals.grand_total }}
      {{ qr_html }} {{ content.note }}
      <style>.parties{grid-template-columns:1fr;}</style>
    `;
    const extracted = extractVisualConfigFromLiquid(liquid, config);
    assert.equal(extracted.sections.lineItems.columns.sku, true);
    assert.equal(extracted.sections.lineItems.columns.quantity, true);
    assert.equal(extracted.sections.totals.showSubtotal, true);
    assert.equal(extracted.sections.qrCode.visible, true);
    assert.equal(extracted.content.showNotes, true);
    assert.equal(extracted.layout.sellerBuyerLayout, "stacked");
  });
});

describe("Group 14 Phase C — rendering + preview", () => {
  it("renderLiquidTemplate produces HTML with context", () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const data = sampleRenderDataForDocumentType("tax_invoice");
    const html = renderLiquidTemplate(
      VALID_INVOICE_LIQUID,
      data,
      config,
      "tax_invoice",
      "",
    );
    assert.match(html, /INV-00042|Acme/i);
    assert.doesNotMatch(html, /<script/i);
  });

  it("Group 7 code sourceType uses Liquid path", async () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      config,
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: null,
      customHtml: VALID_INVOICE_LIQUID,
      sourceType: "code",
      skipLinePrep: true,
    });
    assert.match(html, /INV-00042|Acme/i);
  });

  it("layout sourceType still uses system layout (no Liquid)", async () => {
    const config = getDefaultConfigForLayout("modern", "tax_invoice");
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      config,
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: null,
      sourceType: "layout",
      skipLinePrep: true,
    });
    assert.match(html, /TAX INVOICE|Tax Invoice|Acme/i);
  });

  it("preview renders draft Liquid without writing DB", async () => {
    const { store } = await seedStore("prev");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Preview liquid",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.ok(created);
    const before = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const html = await previewTemplateVisualConfig(
      store.shopifyDomain,
      created!.id,
      {
        sourceType: "code",
        liquidHtml: VALID_INVOICE_LIQUID.replace(
          "{{ document.title }}",
          "<strong>DRAFT-LIQUID-MARKER</strong>",
        ),
        config: before!.config,
      },
    );
    assert.ok(html);
    assert.match(html!, /DRAFT-LIQUID-MARKER/);
    const after = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(after!.template.customHtml, before!.template.customHtml);
  });
});

describe("Group 14 Phase C — document types + Save As + Group 5", () => {
  for (const documentType of [
    "tax_invoice",
    "packing_slip",
    "credit_note",
    "refund_document",
  ] as const) {
    it(`${documentType} starter Liquid validates and renders`, () => {
      const starter = starterLiquidFor(documentType, null);
      const check = validateLiquidSource(starter, documentType);
      // Starter may include warnings but should not have syntax errors.
      assert.ok(
        !check.errors.some((e) => /syntax|Unclosed|missing ">"|empty|too large/i.test(e)),
        check.errors.join("; "),
      );
      const config = getDefaultConfigForLayout("modern", documentType);
      const html = renderLiquidTemplate(
        starter,
        sampleRenderDataForDocumentType(documentType),
        config,
        documentType,
        "",
      );
      assert.ok(html.length > 50);
    });
  }

  it("Save As copies Liquid when sourceType code is applied after create", async () => {
    const { store } = await seedStore("saveas");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Original liquid",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.ok(created);
    const copy = await saveTemplateAsNew(store.shopifyDomain, created!.id, {
      name: "Copy liquid",
      config: (await getTemplateByIdForShop(store.shopifyDomain, created!.id))!
        .config,
    });
    assert.ok(copy);
    await saveTemplateConfig(store.shopifyDomain, copy!.id, {
      name: "Copy liquid",
      config: (await getTemplateByIdForShop(store.shopifyDomain, created!.id))!
        .config,
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID + "\n<!-- copy -->",
    });
    const src = await getTemplateByIdForShop(store.shopifyDomain, created!.id);
    const dst = await getTemplateByIdForShop(store.shopifyDomain, copy!.id);
    assert.doesNotMatch(String(src!.template.customHtml), /<!-- copy -->/);
    assert.match(String(dst!.template.customHtml), /<!-- copy -->/);
  });

  it("Group 5 default resolution unchanged with Liquid custom default", async () => {
    const { store } = await seedStore("g5liq");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Default liquid",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: VALID_INVOICE_LIQUID,
    });
    assert.ok(created);
    await setDefaultTemplate(store.shopifyDomain, created!.id);
    const resolved = await resolveTemplateForShop(
      store.shopifyDomain,
      "tax_invoice",
    );
    assert.equal(resolved!.template.id, created!.id);
    assert.equal(templateSourceKind(resolved!.template), "code");
  });
});

function templateSourceKind(template: {
  sourceType?: string | null;
  customHtml?: string | null;
}) {
  if (template.sourceType === "code") return "code";
  if (template.sourceType === "imported") return "imported";
  if (typeof template.customHtml === "string" && template.customHtml.trim()) {
    return "imported";
  }
  return "layout";
}

describe("Group 14 Phase C — Phase B + wiring regression markers", () => {
  it("visual config still saves without requiring Liquid", async () => {
    const { store } = await seedStore("vis");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Visual only",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const draft = structuredClone(loaded!.config);
    draft.branding.primaryColor = "#112233";
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
      sourceType: "layout",
    });
    const again = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(again!.config.branding.primaryColor, "#112233");
    assert.equal(again!.template.sourceType, "layout");
    assert.equal(again!.template.customHtml, null);
  });

  it("details route wires Liquid validate / from-config / code editor", () => {
    const details = readFileSync(
      join(process.cwd(), "app/routes/app.templates_.$id.tsx"),
      "utf8",
    );
    assert.match(details, /validateTemplateLiquidForShop|intent === "validate"/);
    assert.match(details, /syncConfigToLiquidForShop|from-config/);
    assert.match(details, /codeEditor|editorView|sourceType.*code/);
    assert.match(details, /Load starter|starterLiquidFor|getTemplateLiquidSourceForShop/);
    assert.match(details, /scheduleTemplateThumbnailRefresh/);
  });
});
