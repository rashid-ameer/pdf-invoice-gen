/**
 * Group 14 Phase D — template JPEG thumbnails.
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
  saveTemplateAsNew,
  saveTemplateConfig,
} from "../app/models/template.server";
import {
  getTemplateThumbnailJpeg,
  scheduleTemplateThumbnailRefresh,
} from "../app/models/template-thumbnail.server";
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

async function seedStore(prefix = "thumb") {
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

function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

async function tryGenerate(
  shop: string,
  templateId: string,
): Promise<Buffer | null | "skip"> {
  try {
    return await getTemplateThumbnailJpeg(shop, templateId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/chromium|puppeteer|browser|executable|Could not find/i.test(message)) {
      return "skip";
    }
    throw error;
  }
}

describe("Group 14 Phase D — thumbnail generation", () => {
  it("generates JPEG for layout custom template (or skips without Chromium)", async () => {
    const { store } = await seedStore("gen1");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Thumb layout",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);

    const jpeg = await tryGenerate(store.shopifyDomain, created!.id);
    if (jpeg === "skip") return;
    assert.ok(jpeg);
    assert.ok(isJpeg(jpeg!));

    const row = await prisma.invoiceTemplate.findUnique({
      where: { id: created!.id },
      select: { thumbnailJpeg: true, thumbnailGeneratedAt: true, updatedAt: true },
    });
    assert.ok(row?.thumbnailJpeg);
    assert.ok(row?.thumbnailGeneratedAt);
    // Cache write must not bump updatedAt past generatedAt by more than 1s window intent.
    assert.ok(
      row!.thumbnailGeneratedAt!.getTime() + 1000 >= row!.updatedAt.getTime(),
    );
  });

  it("generates JPEG for Liquid/code template", async () => {
    const { store } = await seedStore("gen2");
    const liquid = `
<!DOCTYPE html><html><body>
<h1>{{ document.title }}</h1>
<p>{{ invoice.number }} {{ seller.trn }} {{ seller.legal_name }}</p>
{% for item in line_items %}<div>{{ item.description }}</div>{% endfor %}
<p>{{ totals.vat_total }} {{ totals.grand_total }}</p>
</body></html>`;
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Thumb liquid",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
      sourceType: "code",
      liquidHtml: liquid,
    });
    assert.ok(created);

    const jpeg = await tryGenerate(store.shopifyDomain, created!.id);
    if (jpeg === "skip") return;
    assert.ok(jpeg);
    assert.ok(isJpeg(jpeg!));
  });

  it("serves cached JPEG on second call without requiring regenerate", async () => {
    const { store } = await seedStore("cache");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Cache",
      baseLayoutCode: "modern",
      documentType: "packing_slip",
    });
    assert.ok(created);
    const first = await tryGenerate(store.shopifyDomain, created!.id);
    if (first === "skip") return;
    assert.ok(first);

    const second = await getTemplateThumbnailJpeg(
      store.shopifyDomain,
      created!.id,
    );
    assert.ok(second);
    assert.equal(second!.equals(first!), true);
  });

  it("document types tax_invoice / credit_note / refund / packing_slip", async () => {
    const { store } = await seedStore("doctypes");
    for (const documentType of [
      "tax_invoice",
      "credit_note",
      "refund_document",
      "packing_slip",
    ] as const) {
      const created = await createCustomTemplate(store.shopifyDomain, {
        name: `Thumb ${documentType}`,
        baseLayoutCode: "modern",
        documentType,
      });
      assert.ok(created);
      const jpeg = await tryGenerate(store.shopifyDomain, created!.id);
      if (jpeg === "skip") return;
      assert.ok(jpeg, documentType);
      assert.ok(isJpeg(jpeg!));
    }
  });
});

describe("Group 14 Phase D — create / Save As / update / delete", () => {
  it("Save As creates a new template; thumbnail is not copied from source row", async () => {
    const { store } = await seedStore("saveas");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Source",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const first = await tryGenerate(store.shopifyDomain, created!.id);
    if (first === "skip") return;

    const copy = await saveTemplateAsNew(store.shopifyDomain, created!.id, {
      name: "Copy",
      config: (await getTemplateByIdForShop(store.shopifyDomain, created!.id))!
        .config,
    });
    assert.ok(copy);
    const copyRow = await prisma.invoiceTemplate.findUnique({
      where: { id: copy!.id },
      select: { thumbnailJpeg: true },
    });
    // Old: Save As does not copy thumbnail blob; regenerate separately.
    assert.equal(copyRow?.thumbnailJpeg, null);

    scheduleTemplateThumbnailRefresh(store.shopifyDomain, copy!.id);
    // Give async refresh a moment when Chromium available.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("config save schedules regeneration (updatedAt invalidates cache)", async () => {
    const { store } = await seedStore("regen");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Regen",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    const first = await tryGenerate(store.shopifyDomain, created!.id);
    if (first === "skip") return;

    const loaded = await getTemplateByIdForShop(
      store.shopifyDomain,
      created!.id,
    );
    const draft = structuredClone(loaded!.config);
    draft.branding.primaryColor = "#AA1122";
    await saveTemplateConfig(store.shopifyDomain, created!.id, {
      config: draft,
      sourceType: "layout",
    });

    // Force stale cache beyond the 1s grace window (old cacheFresh).
    await prisma.$executeRaw`
      UPDATE "InvoiceTemplate"
      SET "thumbnailGeneratedAt" = ${new Date(Date.now() - 5000)}
      WHERE "id" = ${created!.id}
    `;

    const regenerated = await tryGenerate(store.shopifyDomain, created!.id);
    if (regenerated === "skip") return;
    assert.ok(regenerated);
    assert.ok(isJpeg(regenerated!));
    const after = await prisma.invoiceTemplate.findUnique({
      where: { id: created!.id },
      select: { thumbnailGeneratedAt: true },
    });
    assert.ok(after?.thumbnailGeneratedAt);
    assert.ok(after!.thumbnailGeneratedAt!.getTime() > Date.now() - 10_000);
  });

  it("inactive templates return null thumbnail", async () => {
    const { store } = await seedStore("inactive");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Gone",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    await prisma.invoiceTemplate.update({
      where: { id: created!.id },
      data: { isActive: false },
    });
    const jpeg = await getTemplateThumbnailJpeg(
      store.shopifyDomain,
      created!.id,
    );
    assert.equal(jpeg, null);
  });
});

describe("Group 14 Phase D — system + isolation + wiring", () => {
  it("system template thumbnail is readable for an authenticated shop", async () => {
    const { store } = await seedStore("sys");
    const system = await prisma.invoiceTemplate.findFirst({
      where: { isSystem: true, code: "modern", isActive: true },
    });
    assert.ok(system);
    const allowed = await getTemplateByIdForShop(
      store.shopifyDomain,
      system!.id,
    );
    assert.ok(allowed);
    const jpeg = await tryGenerate(store.shopifyDomain, system!.id);
    if (jpeg === "skip") return;
    assert.ok(jpeg);
    assert.ok(isJpeg(jpeg!));
  });

  it("foreign custom template is not loadable; thumbnail route relies on that gate", async () => {
    const a = await seedStore("isoa");
    const b = await seedStore("isob");
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

  it("list items expose thumbnailUrl; routes wire schedule + thumbnail endpoint", () => {
    const list = readFileSync(
      join(process.cwd(), "app/routes/app.templates.tsx"),
      "utf8",
    );
    assert.match(list, /thumbnailDataUrl|TemplateThumb|\/thumbnail/);
    assert.match(list, /scheduleTemplateThumbnailRefresh/);
    assert.match(list, /MiniPreview|thumbnailDataUrl/);

    const details = readFileSync(
      join(process.cwd(), "app/routes/app.templates_.$id.tsx"),
      "utf8",
    );
    assert.match(details, /scheduleTemplateThumbnailRefresh/);
    assert.match(details, /intent === "customize"/);

    const route = readFileSync(
      join(process.cwd(), "app/routes/app.templates_.$id.thumbnail.tsx"),
      "utf8",
    );
    assert.match(route, /getTemplateThumbnailJpeg/);
    assert.match(route, /image\/jpeg/);
    assert.match(route, /authenticate\.admin/);

    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );
    assert.match(schema, /thumbnailJpeg/);
    assert.match(schema, /thumbnailGeneratedAt/);
  });

  it("scheduleTemplateThumbnailRefresh does not throw", async () => {
    const { store } = await seedStore("sched");
    const created = await createCustomTemplate(store.shopifyDomain, {
      name: "Sched",
      baseLayoutCode: "modern",
      documentType: "tax_invoice",
    });
    assert.ok(created);
    assert.doesNotThrow(() =>
      scheduleTemplateThumbnailRefresh(store.shopifyDomain, created!.id),
    );
  });
});
