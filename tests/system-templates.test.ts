import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import { encryptSecret } from "../app/utils/token-crypto";
import {
  SYSTEM_TEMPLATE_CATALOG_VERSION,
  SYSTEM_TEMPLATES,
  buildSystemTemplates,
} from "../app/models/system-template-catalog";
import {
  ensureSystemTemplates,
  resetSystemTemplateEnsureStateForTests,
  resolveConfig,
  resolveTemplateForShop,
} from "../app/models/template.server";
import { getDefaultConfigForLayout } from "../app/models/template-config.defaults";
import { BASE_LAYOUT_CODES } from "../app/models/template-config.types";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoiceTemplate.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore(status: "active" | "uninstalled" = "active") {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `store-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status,
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

describe("system template catalog", () => {
  it("contains exactly 80 templates across 20 layouts and 4 document types", () => {
    const built = buildSystemTemplates();
    assert.equal(built.length, 80);
    assert.equal(SYSTEM_TEMPLATES.length, 80);
    assert.equal(BASE_LAYOUT_CODES.length, 20);
    assert.equal(SYSTEM_TEMPLATE_CATALOG_VERSION, 1);

    const byType = {
      tax_invoice: built.filter((t) => t.documentType === "tax_invoice"),
      credit_note: built.filter((t) => t.documentType === "credit_note"),
      packing_slip: built.filter((t) => t.documentType === "packing_slip"),
      refund_document: built.filter((t) => t.documentType === "refund_document"),
    };
    assert.equal(byType.tax_invoice.length, 20);
    assert.equal(byType.credit_note.length, 20);
    assert.equal(byType.packing_slip.length, 20);
    assert.equal(byType.refund_document.length, 20);

    assert.ok(built.some((t) => t.code === "modern" && t.documentType === "tax_invoice"));
    assert.ok(built.some((t) => t.code === "credit-note" && t.baseLayoutCode === "modern"));
    assert.ok(built.some((t) => t.code === "packing-slip" && t.baseLayoutCode === "modern"));
    assert.ok(built.some((t) => t.code === "refund-document" && t.baseLayoutCode === "modern"));
    assert.ok(built.some((t) => t.code === "credit-note-professional"));
    assert.ok(built.some((t) => t.code === "packing-slip-onyx"));
  });
});

describe("ensureSystemTemplates", () => {
  before(() => {
    resetSystemTemplateEnsureStateForTests();
  });

  it("seeds 80 system templates idempotently without assigning store defaults", async () => {
    resetSystemTemplateEnsureStateForTests();
    await prisma.invoiceTemplate.deleteMany({ where: { isSystem: true } });

    const { store } = await seedStore();
    await ensureSystemTemplates();
    await ensureSystemTemplates();

    const count = await prisma.invoiceTemplate.count({
      where: { isSystem: true, isActive: true },
    });
    assert.equal(count, 80);

    const codes = await prisma.invoiceTemplate.findMany({
      where: { isSystem: true, isActive: true },
      select: { code: true },
    });
    assert.equal(new Set(codes.map((c) => c.code)).size, 80);

    const modern = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern" },
    });
    assert.ok(modern);
    assert.equal(modern!.storeId, null);
    assert.equal(modern!.merchantId, null);
    assert.equal(modern!.version, SYSTEM_TEMPLATE_CATALOG_VERSION);
    assert.equal(modern!.sourceType, "layout");
    assert.ok(modern!.config);

    const reloaded = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    assert.equal(reloaded.defaultTemplateId, null);
    assert.equal(reloaded.defaultPackingSlipTemplateId, null);
    assert.equal(reloaded.defaultCreditNoteTemplateId, null);
    assert.equal(reloaded.defaultRefundDocumentTemplateId, null);
  });

  it("deactivates stale system templates outside the catalog", async () => {
    resetSystemTemplateEnsureStateForTests();
    await prisma.invoiceTemplate.deleteMany({ where: { isSystem: true } });

    await prisma.invoiceTemplate.create({
      data: {
        code: "legacy-gone",
        name: "Legacy",
        isSystem: true,
        isActive: true,
        baseLayoutCode: "modern",
        documentType: "tax_invoice",
        sourceType: "layout",
        version: 1,
      },
    });

    await ensureSystemTemplates();

    const stale = await prisma.invoiceTemplate.findFirst({
      where: { code: "legacy-gone", isSystem: true },
    });
    assert.ok(stale);
    assert.equal(stale!.isActive, false);

    const active = await prisma.invoiceTemplate.count({
      where: { isSystem: true, isActive: true },
    });
    assert.equal(active, 80);
  });
});

describe("resolveTemplateForShop", () => {
  before(async () => {
    resetSystemTemplateEnsureStateForTests();
    await ensureSystemTemplates();
  });

  it("falls back to system codes when store defaults are null", async () => {
    const { store } = await seedStore();

    const tax = await resolveTemplateForShop(store.shopifyDomain, undefined, "tax_invoice");
    const cn = await resolveTemplateForShop(store.shopifyDomain, undefined, "credit_note");
    const ps = await resolveTemplateForShop(store.shopifyDomain, undefined, "packing_slip");
    const rd = await resolveTemplateForShop(
      store.shopifyDomain,
      undefined,
      "refund_document",
    );

    assert.equal(tax?.template.code, "modern");
    assert.equal(cn?.template.code, "credit-note");
    assert.equal(ps?.template.code, "packing-slip");
    assert.equal(rd?.template.code, "refund-document");
    assert.equal(tax?.documentType, "tax_invoice");
    assert.ok(tax?.config.sections.seller.fields.trn);
  });

  it("uses a matching store default and skips a wrong-type default", async () => {
    const { store } = await seedStore();
    const professional = await prisma.invoiceTemplate.findFirstOrThrow({
      where: { isSystem: true, code: "professional", isActive: true },
    });
    const packing = await prisma.invoiceTemplate.findFirstOrThrow({
      where: { isSystem: true, code: "packing-slip", isActive: true },
    });

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultTemplateId: professional.id },
    });
    const byDefault = await resolveTemplateForShop(
      store.shopifyDomain,
      undefined,
      "tax_invoice",
    );
    assert.equal(byDefault?.template.code, "professional");

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultTemplateId: packing.id },
    });
    const wrongType = await resolveTemplateForShop(
      store.shopifyDomain,
      undefined,
      "tax_invoice",
    );
    assert.equal(wrongType?.template.code, "modern");
  });

  it("accepts a requested system template even when document types differ", async () => {
    const { store } = await seedStore();
    const packing = await prisma.invoiceTemplate.findFirstOrThrow({
      where: { isSystem: true, code: "packing-slip", isActive: true },
    });

    const resolved = await resolveTemplateForShop(
      store.shopifyDomain,
      packing.id,
      "tax_invoice",
    );
    assert.equal(resolved?.template.code, "packing-slip");
    assert.equal(resolved?.documentType, "packing_slip");
  });

  it("ignores inactive or foreign custom requested IDs and falls through", async () => {
    const a = await seedStore();
    const b = await seedStore();

    const foreignCustom = await prisma.invoiceTemplate.create({
      data: {
        code: `inv-${randomUUID().slice(0, 6)}-modern-test`,
        name: "Foreign custom",
        isSystem: false,
        isActive: true,
        storeId: b.store.id,
        merchantId: b.merchant.id,
        baseLayoutCode: "modern",
        documentType: "tax_invoice",
        sourceType: "layout",
        config: getDefaultConfigForLayout("modern", "tax_invoice") as object,
      },
    });

    const inactiveSystem = await prisma.invoiceTemplate.findFirstOrThrow({
      where: { isSystem: true, code: "canvas" },
    });
    await prisma.invoiceTemplate.update({
      where: { id: inactiveSystem.id },
      data: { isActive: false },
    });

    try {
      const ignoredForeign = await resolveTemplateForShop(
        a.store.shopifyDomain,
        foreignCustom.id,
        "tax_invoice",
      );
      assert.equal(ignoredForeign?.template.code, "modern");

      const ignoredInactive = await resolveTemplateForShop(
        a.store.shopifyDomain,
        inactiveSystem.id,
        "tax_invoice",
      );
      assert.equal(ignoredInactive?.template.code, "modern");
    } finally {
      await prisma.invoiceTemplate.update({
        where: { id: inactiveSystem.id },
        data: { isActive: true },
      });
    }
  });

  it("returns null when the shop has no active store", async () => {
    const { store } = await seedStore("uninstalled");
    const resolved = await resolveTemplateForShop(
      store.shopifyDomain,
      undefined,
      "tax_invoice",
    );
    assert.equal(resolved, null);
  });

  it("resolveConfig applies packing-slip title lock without pintStrict columns", () => {
    const config = resolveConfig(
      {
        config: getDefaultConfigForLayout("modern", "packing_slip"),
        documentType: "packing_slip",
        baseLayoutCode: "modern",
      },
      "modern",
    );
    assert.equal(config.content.documentTitle.html.includes("PACKING SLIP"), true);
    assert.equal(config.sections.lineItems.columns.quantity, true);
    assert.equal(config.sections.lineItems.columns.vatRate, false);
  });
});
