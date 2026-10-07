/**
 * Group 14 Phase A — custom template CRUD, Save As, delete, set-default, isolation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  createCustomTemplate,
  deleteCustomTemplate,
  duplicateTemplate,
  ensureSystemTemplates,
  getTemplateByIdForShop,
  getTemplatesForShop,
  resolveTemplateForShop,
  saveTemplateAsNew,
  saveTemplateConfig,
  setDefaultTemplate,
} from "../app/models/template.server";
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

async function seedStore(domainPrefix = "tpl") {
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

describe("Group 14 Phase A — list", () => {
  it("lists system templates and store customs; hides foreign customs", async () => {
    const a = await seedStore("lista");
    const b = await seedStore("listb");

    const created = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Store A custom",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const foreign = await createCustomTemplate(b.store.shopifyDomain, {
      name: "Store B custom",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(foreign);

    const list = await getTemplatesForShop(a.store.shopifyDomain, "tax_invoice");
    assert.ok(list);
    assert.ok(list!.systemItems.length >= 1);
    assert.ok(list!.systemItems.every((t) => t.isSystem));
    assert.ok(list!.customItems.some((t) => t.id === created!.id));
    assert.ok(list!.customItems.every((t) => t.isCustom));
    assert.ok(!list!.customItems.some((t) => t.id === foreign!.id));
  });

  it("marks the store default correctly", async () => {
    const { store } = await seedStore("defmark");
    const custom = await createCustomTemplate(store.shopifyDomain, {
      name: "Default candidate",
      baseLayoutCode: "modern",
      documentType: "credit_note",
    });
    assert.ok(custom);
    await setDefaultTemplate(store.shopifyDomain, custom!.id);

    const list = await getTemplatesForShop(store.shopifyDomain, "credit_note");
    assert.ok(list);
    const item = list!.customItems.find((t) => t.id === custom!.id);
    assert.equal(item?.isDefault, true);
    assert.ok(list!.systemItems.every((t) => t.isDefault === false));
  });
});

describe("Group 14 Phase A — create", () => {
  it("creates a store-scoped custom template with old defaults", async () => {
    const { store } = await seedStore("create");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "  ",
      baseLayoutCode: "professional",
      documentType: "packing_slip",
    });
    assert.ok(created);
    assert.equal(created!.name, "Untitled template");
    assert.equal(created!.storeId, store.id);
    assert.equal(created!.merchantId, store.merchantId);
    assert.equal(created!.isSystem, false);
    assert.equal(created!.isActive, true);
    assert.equal(created!.documentType, "packing_slip");
    assert.equal(created!.baseLayoutCode, "professional");
    assert.equal(created!.sourceType, "layout");
    assert.match(created!.code, /^ps-/);
    assert.match(created!.description || "", /professional/);
  });

  it("creates Liquid (code) templates with generated starter HTML", async () => {
    const { store } = await seedStore("code");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Untitled template",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: "",
    });
    assert.ok(created);
    assert.equal(created!.sourceType, "code");
    assert.equal(created!.description, "Custom HTML / Liquid template");
    assert.ok((created!.customHtml || "").length > 50);
  });

  it("clones from a system source template", async () => {
    const { store } = await seedStore("clone");
    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(system);
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "",
      baseLayoutCode: "modern",
      sourceTemplateId: system!.id,
    });
    assert.ok(created);
    assert.equal(created!.documentType, "tax_invoice");
    assert.equal(created!.isSystem, false);
    assert.notEqual(created!.code, system!.code);
  });

  it("rejects invalid base layout at the route parse layer", () => {
    // Service requires typed BaseLayoutCode; route uses parseBaseLayoutCode.
    const source = readFileSync(
      join(process.cwd(), "app/routes/app.templates.tsx"),
      "utf8",
    );
    assert.match(source, /parseBaseLayoutCode/);
    assert.match(source, /Invalid base layout/);
  });
});

describe("Group 14 Phase A — edit", () => {
  it("edits custom name while preserving identity", async () => {
    const { store } = await seedStore("edit");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Before",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const updated = await saveTemplateConfig(store.shopifyDomain, created!.id, {
      name: "After",
      config: {},
    });
    assert.ok(updated);
    assert.equal(updated!.id, created!.id);
    assert.equal(updated!.name, "After");
    assert.equal(updated!.code, created!.code);
  });

  it("cannot edit foreign or system templates via saveTemplateConfig", async () => {
    const a = await seedStore("edita");
    const b = await seedStore("editb");
    const custom = await createCustomTemplate(a.store.shopifyDomain, {
      name: "A only",
      baseLayoutCode: "modern",
    });
    assert.ok(custom);

    const foreign = await saveTemplateConfig(b.store.shopifyDomain, custom!.id, {
      name: "Hacked",
      config: {},
    });
    assert.equal(foreign, null);

    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(system);
    const systemSave = await saveTemplateConfig(a.store.shopifyDomain, system!.id, {
      name: "Nope",
      config: {},
    });
    assert.equal(systemSave, null);
  });
});

describe("Group 14 Phase A — save as / duplicate", () => {
  it("save as creates a new custom without changing the source", async () => {
    const { store } = await seedStore("saveas");
    const source = await createCustomTemplate(store.shopifyDomain, {
      name: "Original",
      baseLayoutCode: "modern",
      documentType: "refund_document",
    });
    assert.ok(source);

    const copy = await saveTemplateAsNew(store.shopifyDomain, source!.id, {
      name: "Copy name",
      config: {},
    });
    assert.ok(copy);
    assert.notEqual(copy!.id, source!.id);
    assert.notEqual(copy!.code, source!.code);
    assert.equal(copy!.name, "Copy name");
    assert.equal(copy!.storeId, store.id);
    assert.equal(copy!.isSystem, false);
    assert.equal(copy!.documentType, "refund_document");

    const original = await prisma.invoiceTemplate.findUnique({
      where: { id: source!.id },
    });
    assert.equal(original!.name, "Original");
  });

  it("duplicateTemplate always suffixes (copy)", async () => {
    const { store } = await seedStore("dup");
    const source = await createCustomTemplate(store.shopifyDomain, {
      name: "Dup me",
      baseLayoutCode: "modern",
    });
    const copy = await duplicateTemplate(store.shopifyDomain, source!.id);
    assert.ok(copy);
    assert.equal(copy!.name, "Dup me (copy)");
  });

  it("save as from a system template creates a custom", async () => {
    const { store } = await seedStore("sysas");
    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "packing-slip", isActive: true },
    });
    assert.ok(system);
    const copy = await saveTemplateAsNew(store.shopifyDomain, system!.id, {
      name: "From system",
      config: {},
    });
    assert.ok(copy);
    assert.equal(copy!.isSystem, false);
    assert.equal(copy!.documentType, "packing_slip");
  });
});

describe("Group 14 Phase A — delete", () => {
  it("soft-deletes custom templates and refuses system/foreign", async () => {
    const a = await seedStore("dela");
    const b = await seedStore("delb");
    const custom = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Delete me",
      baseLayoutCode: "modern",
    });
    assert.ok(custom);

    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.equal(await deleteCustomTemplate(a.store.shopifyDomain, system!.id), false);
    assert.equal(await deleteCustomTemplate(b.store.shopifyDomain, custom!.id), false);

    assert.equal(await deleteCustomTemplate(a.store.shopifyDomain, custom!.id), true);
    const row = await prisma.invoiceTemplate.findUnique({ where: { id: custom!.id } });
    assert.equal(row!.isActive, false);

    const byId = await getTemplateByIdForShop(a.store.shopifyDomain, custom!.id);
    assert.equal(byId, null);
  });

  it("resetting a deleted default falls back to the system template", async () => {
    const { store } = await seedStore("deldef");
    const custom = await createCustomTemplate(store.shopifyDomain, {
      name: "Was default",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    await setDefaultTemplate(store.shopifyDomain, custom!.id);

    assert.equal(await deleteCustomTemplate(store.shopifyDomain, custom!.id), true);

    const refreshed = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
    });
    const modern = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.equal(refreshed.defaultTemplateId, modern!.id);

    const resolved = await resolveTemplateForShop(
      store.shopifyDomain,
      undefined,
      "tax_invoice",
    );
    assert.equal(resolved?.template.id, modern!.id);
  });
});

describe("Group 14 Phase A — set default + Group 5 resolver", () => {
  it("sets custom defaults per document type and resolves them", async () => {
    const { store } = await seedStore("setdefault");

    const invoice = await createCustomTemplate(store.shopifyDomain, {
      name: "Inv default",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    const packing = await createCustomTemplate(store.shopifyDomain, {
      name: "Pack default",
      baseLayoutCode: "modern",
      documentType: "packing_slip",
    });
    const credit = await createCustomTemplate(store.shopifyDomain, {
      name: "CN default",
      baseLayoutCode: "modern",
      documentType: "credit_note",
    });
    const refund = await createCustomTemplate(store.shopifyDomain, {
      name: "RD default",
      baseLayoutCode: "modern",
      documentType: "refund_document",
    });

    assert.ok(await setDefaultTemplate(store.shopifyDomain, invoice!.id));
    assert.ok(await setDefaultTemplate(store.shopifyDomain, packing!.id));
    assert.ok(await setDefaultTemplate(store.shopifyDomain, credit!.id));
    assert.ok(await setDefaultTemplate(store.shopifyDomain, refund!.id));

    assert.equal(
      (await resolveTemplateForShop(store.shopifyDomain, undefined, "tax_invoice"))
        ?.template.id,
      invoice!.id,
    );
    assert.equal(
      (
        await resolveTemplateForShop(
          store.shopifyDomain,
          undefined,
          "packing_slip",
        )
      )?.template.id,
      packing!.id,
    );
    assert.equal(
      (
        await resolveTemplateForShop(store.shopifyDomain, undefined, "credit_note")
      )?.template.id,
      credit!.id,
    );
    assert.equal(
      (
        await resolveTemplateForShop(
          store.shopifyDomain,
          undefined,
          "refund_document",
        )
      )?.template.id,
      refund!.id,
    );
  });

  it("cannot set a foreign template as default; system fallback still works", async () => {
    const a = await seedStore("defa");
    const b = await seedStore("defb");
    const custom = await createCustomTemplate(a.store.shopifyDomain, {
      name: "A default",
      baseLayoutCode: "modern",
    });
    assert.equal(await setDefaultTemplate(b.store.shopifyDomain, custom!.id), null);

    const resolved = await resolveTemplateForShop(
      b.store.shopifyDomain,
      undefined,
      "tax_invoice",
    );
    assert.equal(resolved?.template.isSystem, true);
    assert.equal(resolved?.template.code, "modern");
  });
});

describe("Group 14 Phase A — store isolation", () => {
  it("getTemplateByIdForShop blocks foreign customs", async () => {
    const a = await seedStore("isoa");
    const b = await seedStore("isob");
    const custom = await createCustomTemplate(a.store.shopifyDomain, {
      name: "Private",
      baseLayoutCode: "modern",
    });
    assert.equal(
      await getTemplateByIdForShop(b.store.shopifyDomain, custom!.id),
      null,
    );
    assert.ok(
      await getTemplateByIdForShop(a.store.shopifyDomain, custom!.id),
    );
  });
});

describe("Group 14 Phase A — UI wiring", () => {
  it("registers Templates nav and Polaris list/details routes", () => {
    const nav = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");
    assert.match(nav, /href="\/app\/templates"/);

    const list = readFileSync(
      join(process.cwd(), "app/routes/app.templates.tsx"),
      "utf8",
    );
    assert.match(list, /heading="Templates"/);
    assert.match(list, /Create new template/);
    assert.match(list, /createCustomTemplate/);
    assert.match(list, /setDefaultTemplate/);
    assert.match(list, /deleteCustomTemplate/);
    assert.match(list, /authenticate\.admin/);
    assert.match(list, /TemplateCard|s-section/);

    const details = readFileSync(
      join(process.cwd(), "app/routes/app.templates_.$id.tsx"),
      "utf8",
    );
    assert.match(details, /saveTemplateConfig/);
    assert.match(details, /saveTemplateAsNew/);
    assert.match(details, /Save as/);
    assert.match(details, /TemplateVisualConfigEditor|previewTemplateVisualConfig/);
    assert.match(details, /configJson/);
    assert.match(details, /validateTemplateLiquidForShop/);
    assert.match(details, /codeEditor|editorView|sourceType/);
    assert.match(details, /scheduleTemplateThumbnailRefresh/);
  });
});
