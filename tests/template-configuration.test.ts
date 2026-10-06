/**
 * Group 14 Phase B — visual template configuration load/save, isolation, rendering.
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
  mergeDraftTemplateConfig,
  parseConfigJsonFromForm,
  previewTemplateVisualConfig,
  resolveTemplateForShop,
  saveTemplateAsNew,
  saveTemplateConfig,
  setDefaultTemplate,
} from "../app/models/template.server";
import {
  mergeConfigWithBranding,
  SAMPLE_INVOICE_DATA,
} from "../app/models/template-config.defaults";
import type { TemplateConfig } from "../app/models/template-config.types";
import {
  renderDocumentHtml,
  renderDocumentPdf,
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

async function seedStore(domainPrefix = "cfg") {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `${domainPrefix}-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

function patchColors(config: TemplateConfig, primary: string): TemplateConfig {
  const next = structuredClone(config);
  next.branding.primaryColor = primary;
  next.branding.accentColor = primary;
  next.content.documentTitle = {
    html: `<p><strong>CUSTOM TITLE ${primary}</strong></p>`,
  };
  next.sections.qrCode = { visible: true };
  next.typography.baseFontSize = 12;
  return next;
}

describe("Group 14 Phase B — loading", () => {
  it("1. custom template configuration loads", async () => {
    const { store } = await seedStore("load1");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Load me",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(loaded);
    assert.equal(loaded!.template.id, created!.id);
    assert.ok(loaded!.config.branding.primaryColor);
    assert.ok(loaded!.config.typography.fontFamily);
    assert.ok(loaded!.config.sections.seller);
  });

  it("2. missing configuration receives correct defaults", async () => {
    const { store } = await seedStore("load2");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Sparse",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    await prisma.invoiceTemplate.update({
      where: { id: created!.id },
      data: { config: {} },
    });

    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(loaded);
    assert.match(loaded!.config.branding.primaryColor, /^#[0-9A-Fa-f]{6}$/);
    assert.ok(loaded!.config.content.documentTitle.html.length > 0);
    assert.equal(typeof loaded!.config.sections.totals.showGrandTotal, "boolean");
  });

  it("3. system template configuration remains readable", async () => {
    const { store } = await seedStore("load3");
    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(system);

    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      system!.id,
    );
    assert.ok(loaded);
    assert.equal(loaded!.template.isSystem, true);
    assert.ok(loaded!.config.layout.headerStyle);
  });

  it("4. foreign template cannot be loaded", async () => {
    const a = await seedStore("load4a");
    const b = await seedStore("load4b");
    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Private",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const foreign = await getTemplateByIdForShop(
      b.store.shopifyDomain,
      created!.id,
    );
    assert.equal(foreign, null);
  });
});

describe("Group 14 Phase B — configuration persistence", () => {
  it("5–7. visual configuration can be saved and survives reload", async () => {
    const { store } = await seedStore("save1");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Persist",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const before = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(before);

    const draft = patchColors(before!.config, "#AABBCC");
    draft.sections.buyer.visible = false;
    draft.labels.seller = "Vendor";

    const updated = await saveTemplateConfig(store.shopifyDomain, created!.id, {
      name: "Persist",
      config: draft,
    });
    assert.ok(updated);

    const reloaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(reloaded);
    assert.equal(reloaded!.config.branding.primaryColor, "#AABBCC");
    assert.equal(reloaded!.config.sections.buyer.visible, false);
    assert.equal(reloaded!.config.labels.seller, "Vendor");
    assert.match(
      reloaded!.config.content.documentTitle.html,
      /CUSTOM TITLE #AABBCC/,
    );
    // Unrelated name/layout unchanged
    assert.equal(reloaded!.template.baseLayoutCode, "modern");
    assert.equal(reloaded!.template.name, "Persist");
  });

  it("8. invalid configuration is rejected", async () => {
    const { store } = await seedStore("save2");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Invalid",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const before = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(before);
    const originalPrimary = before!.config.branding.primaryColor;

    await assert.rejects(
      () =>
        saveTemplateConfig(store.shopifyDomain, created!.id, {
          config: {
            branding: { primaryColor: "not-a-color" },
          },
        }),
    );

    const after = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(after!.config.branding.primaryColor, originalPrimary);

    assert.throws(() =>
      parseConfigJsonFromForm(
        before!.config,
        JSON.stringify({ branding: { primaryColor: "nope" } }),
        "tax_invoice",
      ),
    );
  });

  it("9. store ownership is enforced on save", async () => {
    const a = await seedStore("own1");
    const b = await seedStore("own2");
    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Owned",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const result = await saveTemplateConfig(b.store.shopifyDomain, created!.id, {
      config: { branding: { primaryColor: "#FF0000" } },
    });
    assert.equal(result, null);
  });
});

describe("Group 14 Phase B — document types", () => {
  for (const documentType of [
    "tax_invoice",
    "packing_slip",
    "credit_note",
    "refund_document",
  ] as const) {
    it(`${documentType} configuration works`, async () => {
      const { store } = await seedStore(`dt-${documentType}`);
      const layout =
        documentType === "packing_slip"
          ? ("modern" as const)
          : documentType === "credit_note"
            ? ("modern" as const)
            : ("modern" as const);

      const created = await createCustomTemplate(store.shopifyDomain, {
        name: `${documentType} tpl`,
        baseLayoutCode: layout,
        documentType,
      });
      assert.ok(created);
      const loaded = await getTemplateByIdForShop(
        store.shopifyDomain,
        created!.id,
      );
      assert.ok(loaded);
      assert.equal(loaded!.documentType, documentType);

      const draft = structuredClone(loaded!.config);
      draft.typography.headingFontSize = 24;
      if (documentType === "packing_slip") {
        draft.sections.totals.visible = false;
        draft.sections.seller.fields.trn = false;
      } else {
        draft.sections.qrCode = { visible: true };
      }

      const saved = await saveTemplateConfig(store.shopifyDomain, created!.id, {
        config: draft,
      });
      assert.ok(saved);

      const again = await getTemplateByIdForShop(
        store.shopifyDomain,
        created!.id,
      );
      assert.equal(again!.config.typography.headingFontSize, 24);

      const html = await previewTemplateVisualConfig(
        store.shopifyDomain,
        created!.id,
      );
      assert.ok(html);
      assert.match(html!, /<html/i);
    });
  }
});

describe("Group 14 Phase B — Save As", () => {
  it("14–15. Save As copies configuration; original unchanged", async () => {
    const { store } = await seedStore("saveas");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Original",
      baseLayoutCode: "professional",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const original = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(original);

    const draft = patchColors(original!.config, "#55AA55");
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
    });

    const copied = await saveTemplateAsNew(store.shopifyDomain, created!.id, {
      name: "Copy",
      config: {
        ...draft,
        branding: { ...draft.branding, primaryColor: "#665544" },
      },
    });
    assert.ok(copied);

    const src = await getTemplateByIdForShop(store.shopifyDomain, created!.id);
    const dst = await getTemplateByIdForShop(store.shopifyDomain, copied!.id);
    assert.equal(src!.config.branding.primaryColor, "#55AA55");
    assert.equal(dst!.config.branding.primaryColor, "#665544");
    assert.equal(src!.template.name, "Original");
    assert.equal(dst!.template.name, "Copy");
    assert.notEqual(src!.template.id, dst!.template.id);
  });
});

describe("Group 14 Phase B — Group 5 defaults", () => {
  it("16–17. resolver still resolves selected default; system fallback intact", async () => {
    const { store } = await seedStore("g5");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Default candidate",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const before = await resolveTemplateForShop(
      store.shopifyDomain,
      "tax_invoice",
    );
    assert.ok(before);
    assert.equal(before!.template.isSystem, true);

    await setDefaultTemplate(store.shopifyDomain, created!.id);
    const after = await resolveTemplateForShop(
      store.shopifyDomain,
      "tax_invoice",
    );
    assert.ok(after);
    assert.equal(after!.template.id, created!.id);

    // System fallback still listed / resolvable when no custom default path breaks
    const systemModern = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(systemModern);
  });
});

describe("Group 14 Phase B — Group 7 rendering", () => {
  it("18. saved configuration affects Group 7 HTML rendering", async () => {
    const { store } = await seedStore("rend1");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Render HTML",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const draft = patchColors(loaded!.config, "#C0FFEE");
    draft.content.documentTitle = {
      html: "<p><strong>PHASE-B-MARKER-TITLE</strong></p>",
    };
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
    });

    const again = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const html = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      config: again!.config,
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: null,
      sourceType: "layout",
      skipLinePrep: true,
    });
    assert.match(html, /PHASE-B-MARKER-TITLE/);
    assert.match(html, /#C0FFEE/i);

    const preview = await previewTemplateVisualConfig(
      store.shopifyDomain,
      created!.id,
      {
        content: {
          documentTitle: { html: "<p><strong>DRAFT-PREVIEW-TITLE</strong></p>" },
        },
      },
    );
    assert.ok(preview);
    assert.match(preview!, /DRAFT-PREVIEW-TITLE/);
  });

  it("19. saved configuration affects PDF rendering where Chromium is available", async () => {
    const { store } = await seedStore("rend2");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Render PDF",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const draft = patchColors(loaded!.config, "#ABCDEF");
    draft.content.documentTitle = {
      html: "<p><strong>PDF-PHASE-B</strong></p>",
    };
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
    });
    const again = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );

    try {
      const pdf = await renderDocumentPdf({
        baseLayoutCode: "modern",
        documentType: "tax_invoice",
        config: again!.config,
        data: { ...SAMPLE_INVOICE_DATA } as never,
        branding: null,
        sourceType: "layout",
        skipLinePrep: true,
      });
      assert.ok(pdf.length > 100);
      assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/chromium|puppeteer|browser|executable/i.test(message)) {
        // Acceptable skip when Chromium is unavailable in CI/dev.
        return;
      }
      throw error;
    }
  });
});

describe("Group 14 Phase B — branding", () => {
  it("20–21. store branding merges; template config does not overwrite unexpectedly", async () => {
    const { store } = await seedStore("brand");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Brand merge",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const draft = patchColors(loaded!.config, "#EEEEEE");
    draft.content.footer = { html: "<p>Template footer</p>" };
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
    });
    const again = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );

    // Without branding: template colors remain.
    const raw = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      config: again!.config,
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: null,
      sourceType: "layout",
      skipLinePrep: true,
    });
    assert.match(raw, /#EEEEEE/i);

    const merged = mergeConfigWithBranding(
      again!.config,
      {
        primaryColor: "#111111",
        secondaryColor: "#222222",
        accentColor: "#333333",
        footerText: "Store branding footer",
      },
      "tax_invoice",
    );
    assert.equal(merged.branding.primaryColor, "#111111");
    assert.match(merged.content.footer.html, /Store branding footer/);

    const withBrand = await renderDocumentHtml({
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      config: again!.config,
      data: sampleRenderDataForDocumentType("tax_invoice"),
      branding: {
        primaryColor: "#111111",
        secondaryColor: "#222222",
        accentColor: "#333333",
        footerText: "Store branding footer",
      },
      sourceType: "layout",
      skipLinePrep: true,
    });
    assert.match(withBrand, /#111111/i);
    assert.match(withBrand, /Store branding footer/);
  });
});

describe("Group 14 Phase B — security", () => {
  it("22–23. foreign store cannot modify; client cannot override ownership", async () => {
    const a = await seedStore("sec1");
    const b = await seedStore("sec2");
    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Secure",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const denied = await saveTemplateConfig(b.store.shopifyDomain, created!.id, {
      config: { branding: { primaryColor: "#000000" } },
    });
    assert.equal(denied, null);

    const previewDenied = await previewTemplateVisualConfig(
      b.store.shopifyDomain,
      created!.id,
      { branding: { primaryColor: "#000000" } },
    );
    assert.equal(previewDenied, null);

    // saveTemplateConfig always resolves store from shopDomain — no client storeId.
    const src = readFileSync(
      join(process.cwd(), "app/models/template.server.ts"),
      "utf8",
    );
    assert.match(src, /getTemplateByIdForShop\(shopDomain/);
    assert.match(src, /previewTemplateVisualConfig/);
    assert.match(src, /mergeDraftTemplateConfig/);
  });
});

describe("Group 14 Phase B — draft merge helpers", () => {
  it("mergeDraftTemplateConfig applies compliance locks", async () => {
    const { getDefaultConfigForLayout } = await import(
      "../app/models/template-config.defaults"
    );
    const base = getDefaultConfigForLayout("modern", "tax_invoice");
    const merged = mergeDraftTemplateConfig(
      base,
      {
        sections: {
          seller: { fields: { trn: false, legalName: false } },
        },
      },
      "tax_invoice",
    );
    // Compliance locks force TRN + legal name on tax invoices.
    assert.equal(merged.sections.seller.fields.trn, true);
    assert.equal(merged.sections.seller.fields.legalName, true);
  });
});
