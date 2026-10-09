import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  dismissInitialSetup,
  finishInitialSetup,
  getInitialSetupState,
  isCompanySetupDataComplete,
  markInitialSetupRequired,
  nextMissingTemplateType,
} from "../app/models/initial-setup.server";
import {
  INITIAL_SETUP_COMPLETED_KEY,
  INITIAL_SETUP_DISMISSED_KEY,
  INITIAL_SETUP_REQUIRED_KEY,
  initialSetupTemplateHref,
  isInitialSetupPathAllowed,
  isInitialSetupQuery,
} from "../app/models/initial-setup";
import { saveCompanySetup } from "../app/models/onboarding.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string; shop: string }> =
  [];

after(async () => {
  for (const row of cleanup) {
    await prisma.taxIdentifier.deleteMany({
      where: { legalEntity: { merchantId: row.merchantId } },
    });
    await prisma.legalEntity.deleteMany({ where: { merchantId: row.merchantId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore(opts?: { requireSetup?: boolean }) {
  const shop = `setup-${randomUUID()}.myshopify.com`;
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: shop,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id, shop });
  if (opts?.requireSetup) {
    await markInitialSetupRequired(store);
  }
  return { merchant, store, shop };
}

function validCompanyBody(overrides: Record<string, unknown> = {}) {
  return {
    legalName: "Acme Trading LLC",
    tradeName: "Acme",
    vatStatus: "registered",
    trn: "100000000000003",
    tin: "",
    tradeLicence: "TL-1",
    addressLine1: "Street 1",
    addressLine2: "",
    emirate: "Dubai",
    city: "Dubai",
    postalCode: "00000",
    country: "AE",
    businessEmail: "ops@acme.test",
    businessPhone: "+971500000000",
    vatRate: "5",
    taxInclusive: "false",
    invoicePrefix: "INV-",
    creditNotePrefix: "CN-",
    ...overrides,
  };
}

describe("initial setup path allowlist", () => {
  it("allows home, company, and templates while blocking other app routes", () => {
    assert.equal(isInitialSetupPathAllowed("/app"), true);
    assert.equal(isInitialSetupPathAllowed("/app/"), true);
    assert.equal(isInitialSetupPathAllowed("/app/settings/company"), true);
    assert.equal(isInitialSetupPathAllowed("/app/settings/templates"), true);
    assert.equal(
      isInitialSetupPathAllowed("/app/settings/templates/tax-invoice/change"),
      true,
    );
    assert.equal(
      isInitialSetupPathAllowed("/app/settings/templates/abc123"),
      true,
    );
    assert.equal(isInitialSetupPathAllowed("/app/invoices"), false);
    assert.equal(isInitialSetupPathAllowed("/app/credit-notes"), false);
    assert.equal(isInitialSetupPathAllowed("/app/packing-slips"), false);
    assert.equal(isInitialSetupPathAllowed("/app/help"), false);
    assert.equal(isInitialSetupPathAllowed("/app/settings"), false);
    assert.equal(isInitialSetupPathAllowed("/app/compliance"), false);
  });

  it("parses setup query and builds onboarding template hrefs", () => {
    assert.equal(isInitialSetupQuery("1"), true);
    assert.equal(isInitialSetupQuery("true"), true);
    assert.equal(isInitialSetupQuery(null), false);
    assert.match(
      initialSetupTemplateHref("tax_invoice"),
      /\/change\?setup=1$/,
    );
    assert.match(
      initialSetupTemplateHref("packing_slip"),
      /packing-slip\/change\?setup=1$/,
    );
  });
});

describe("new vs existing merchants", () => {
  it("grandfathered store without required flag is not locked", async () => {
    const { shop } = await seedStore();
    const state = await getInitialSetupState(shop);
    assert.ok(state);
    assert.equal(state!.required, false);
    assert.equal(state!.locked, false);
    assert.equal(state!.showOnHome, false);
    assert.equal(state!.dismissed, false);
    assert.equal(state!.companyComplete, false);
    assert.equal(state!.templatesComplete, false);
  });

  it("new install flag locks the store until finish", async () => {
    const { shop } = await seedStore({ requireSetup: true });
    const state = await getInitialSetupState(shop);
    assert.ok(state);
    assert.equal(state!.required, true);
    assert.equal(state!.completed, false);
    assert.equal(state!.locked, true);
    assert.equal(state!.showOnHome, true);
    assert.equal(state!.dismissed, false);
  });

  it("markInitialSetupRequired writes store-scoped Setting", async () => {
    const { store } = await seedStore();
    await markInitialSetupRequired(store);
    const row = await prisma.setting.findUnique({
      where: {
        merchantId_storeId_key: {
          merchantId: store.merchantId,
          storeId: store.id,
          key: INITIAL_SETUP_REQUIRED_KEY,
        },
      },
    });
    assert.equal(row?.value, true);
    assert.equal(row?.scope, "store");
  });

  it("updating an existing store does not re-arm via mark only on create path", async () => {
    const { shop, store } = await seedStore();
    // Simulate reinstall/update: store exists, no markInitialSetupRequired call.
    const before = await prisma.setting.count({
      where: { storeId: store.id, key: INITIAL_SETUP_REQUIRED_KEY },
    });
    assert.equal(before, 0);
    const state = await getInitialSetupState(shop);
    assert.equal(state!.locked, false);
  });
});

describe("company setup stage", () => {
  it("is incomplete until required company fields are saved", async () => {
    const { shop } = await seedStore({ requireSetup: true });
    let state = await getInitialSetupState(shop);
    assert.equal(state!.companyComplete, false);

    await assert.rejects(() =>
      saveCompanySetup(shop, validCompanyBody({ legalName: "" })),
    );
    state = await getInitialSetupState(shop);
    assert.equal(state!.companyComplete, false);
    assert.equal(state!.locked, true);

    await saveCompanySetup(shop, validCompanyBody());
    state = await getInitialSetupState(shop);
    assert.equal(state!.companyComplete, true);
    assert.equal(state!.templatesComplete, false);
    assert.equal(state!.stagesComplete, false);
    assert.equal(state!.locked, true);
  });

  it("isCompanySetupDataComplete mirrors saveCompanySetup required rules", () => {
    assert.equal(
      isCompanySetupDataComplete({
        legalName: "Acme",
        businessEmail: "a@b.c",
        businessPhone: "+1",
        vatStatus: "registered",
        trn: "100000000000003",
        address: { line1: "1 St", city: "Dubai", country: "AE" },
      }),
      true,
    );
    assert.equal(
      isCompanySetupDataComplete({
        legalName: "Acme",
        businessEmail: "a@b.c",
        businessPhone: "+1",
        vatStatus: "registered",
        trn: "",
        address: { line1: "1 St", city: "Dubai", country: "AE" },
      }),
      false,
    );
    assert.equal(
      isCompanySetupDataComplete({
        legalName: "Acme",
        businessEmail: "a@b.c",
        businessPhone: "+1",
        vatStatus: "not_registered",
        trn: "",
        address: { line1: "1 St", city: "Dubai", country: "AE" },
      }),
      true,
    );
  });
});

describe("template stage progression", () => {
  it("resumes at the first missing template and does not reset existing defaults", async () => {
    const { shop, store } = await seedStore({ requireSetup: true });
    await saveCompanySetup(shop, validCompanyBody());

    let state = await getInitialSetupState(shop);
    assert.equal(state!.nextTemplateType, "tax_invoice");

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultTemplateId: "tpl-invoice" },
    });
    state = await getInitialSetupState(shop);
    assert.equal(state!.nextTemplateType, "packing_slip");
    assert.equal(state!.templateDefaults.tax_invoice, true);

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultPackingSlipTemplateId: "tpl-packing" },
    });
    state = await getInitialSetupState(shop);
    assert.equal(state!.nextTemplateType, "credit_note");

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultCreditNoteTemplateId: "tpl-cn" },
    });
    state = await getInitialSetupState(shop);
    assert.equal(state!.nextTemplateType, "refund_document");

    await prisma.store.update({
      where: { id: store.id },
      data: { defaultRefundDocumentTemplateId: "tpl-refund" },
    });
    state = await getInitialSetupState(shop);
    assert.equal(state!.nextTemplateType, null);
    assert.equal(state!.templatesComplete, true);
    assert.equal(state!.stagesComplete, true);
    assert.equal(state!.locked, true);

    // Existing defaults unchanged
    const refreshed = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
    });
    assert.equal(refreshed.defaultTemplateId, "tpl-invoice");
    assert.equal(refreshed.defaultPackingSlipTemplateId, "tpl-packing");
  });

  it("nextMissingTemplateType follows Invoice → Packing → Credit → Refund", () => {
    assert.equal(
      nextMissingTemplateType({
        defaultTemplateId: null,
        defaultPackingSlipTemplateId: null,
        defaultCreditNoteTemplateId: null,
        defaultRefundDocumentTemplateId: null,
      }),
      "tax_invoice",
    );
    assert.equal(
      nextMissingTemplateType({
        defaultTemplateId: "a",
        defaultPackingSlipTemplateId: null,
        defaultCreditNoteTemplateId: "c",
        defaultRefundDocumentTemplateId: "d",
      }),
      "packing_slip",
    );
    assert.equal(
      nextMissingTemplateType({
        defaultTemplateId: "a",
        defaultPackingSlipTemplateId: "b",
        defaultCreditNoteTemplateId: "c",
        defaultRefundDocumentTemplateId: "d",
      }),
      null,
    );
  });
});

describe("finish setup", () => {
  it("rejects finish until both stages are complete, then unlocks", async () => {
    const { shop, store } = await seedStore({ requireSetup: true });

    let result = await finishInitialSetup(shop);
    assert.equal(result.ok, false);

    await saveCompanySetup(shop, validCompanyBody());
    result = await finishInitialSetup(shop);
    assert.equal(result.ok, false);

    await prisma.store.update({
      where: { id: store.id },
      data: {
        defaultTemplateId: "tpl-invoice",
        defaultPackingSlipTemplateId: "tpl-packing",
        defaultCreditNoteTemplateId: "tpl-cn",
        defaultRefundDocumentTemplateId: "tpl-refund",
      },
    });

    result = await finishInitialSetup(shop);
    assert.equal(result.ok, true);

    const completed = await prisma.setting.findUnique({
      where: {
        merchantId_storeId_key: {
          merchantId: store.merchantId,
          storeId: store.id,
          key: INITIAL_SETUP_COMPLETED_KEY,
        },
      },
    });
    assert.equal(completed?.value, true);

    const state = await getInitialSetupState(shop);
    assert.equal(state!.locked, false);
    assert.equal(state!.completed, true);
    assert.equal(state!.showOnHome, true);
    assert.equal(state!.dismissed, false);
    assert.equal(isInitialSetupPathAllowed("/app/invoices"), false);
    // Path allowlist is independent of lock; unlock is via locked=false in app loader.
    assert.equal(state!.required, true);
  });

  it("does not unlock grandfathered stores via finish when not required", async () => {
    const { shop } = await seedStore();
    const result = await finishInitialSetup(shop);
    assert.equal(result.ok, false);
    const state = await getInitialSetupState(shop);
    assert.equal(state!.locked, false);
  });
});

describe("dismiss setup", () => {
  async function finishReadyStore(shop: string, storeId: string) {
    await saveCompanySetup(shop, validCompanyBody());
    await prisma.store.update({
      where: { id: storeId },
      data: {
        defaultTemplateId: "tpl-invoice",
        defaultPackingSlipTemplateId: "tpl-packing",
        defaultCreditNoteTemplateId: "tpl-cn",
        defaultRefundDocumentTemplateId: "tpl-refund",
      },
    });
    const result = await finishInitialSetup(shop);
    assert.equal(result.ok, true);
  }

  it("rejects dismiss until setup is finished", async () => {
    const { shop } = await seedStore({ requireSetup: true });
    const result = await dismissInitialSetup(shop);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Finish setup/i);
    }
  });

  it("after finish, showOnHome stays true until dismiss", async () => {
    const { shop, store } = await seedStore({ requireSetup: true });
    await finishReadyStore(shop, store.id);

    let state = await getInitialSetupState(shop);
    assert.equal(state!.locked, false);
    assert.equal(state!.showOnHome, true);
    assert.equal(state!.dismissed, false);

    const result = await dismissInitialSetup(shop);
    assert.equal(result.ok, true);

    const dismissed = await prisma.setting.findUnique({
      where: {
        merchantId_storeId_key: {
          merchantId: store.merchantId,
          storeId: store.id,
          key: INITIAL_SETUP_DISMISSED_KEY,
        },
      },
    });
    assert.equal(dismissed?.value, true);

    state = await getInitialSetupState(shop);
    assert.equal(state!.locked, false);
    assert.equal(state!.completed, true);
    assert.equal(state!.dismissed, true);
    assert.equal(state!.showOnHome, false);
  });

  it("rejects dismiss when already dismissed", async () => {
    const { shop, store } = await seedStore({ requireSetup: true });
    await finishReadyStore(shop, store.id);
    assert.equal((await dismissInitialSetup(shop)).ok, true);
    const again = await dismissInitialSetup(shop);
    assert.equal(again.ok, false);
    if (!again.ok) {
      assert.match(again.error, /already dismissed/i);
    }
  });

  it("rejects dismiss for grandfathered stores", async () => {
    const { shop } = await seedStore();
    const result = await dismissInitialSetup(shop);
    assert.equal(result.ok, false);
  });
});

describe("persistence across reloads", () => {
  it("preserves progress after re-reading state", async () => {
    const { shop, store } = await seedStore({ requireSetup: true });
    await saveCompanySetup(shop, validCompanyBody());
    await prisma.store.update({
      where: { id: store.id },
      data: {
        defaultTemplateId: "tpl-invoice",
        defaultPackingSlipTemplateId: "tpl-packing",
      },
    });

    const again = await getInitialSetupState(shop);
    assert.equal(again!.companyComplete, true);
    assert.equal(again!.nextTemplateType, "credit_note");
    assert.equal(again!.locked, true);
  });
});

describe("install wiring", () => {
  it("handleAppInstall create path marks required; update path does not", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "app/models/install.server.ts"),
      "utf8",
    );
    assert.match(src, /markInitialSetupRequired\(store\)/);
    // Required mark sits in the create branch only (after store.create).
    const createIdx = src.indexOf("prisma.store.create");
    const markIdx = src.indexOf("markInitialSetupRequired(store)");
    const updateIdx = src.indexOf("prisma.store.update");
    assert.ok(createIdx > 0);
    assert.ok(markIdx > createIdx);
    // update branch appears before create in the file; mark must not be between update start and create.
    assert.ok(updateIdx > 0 && updateIdx < createIdx);
    assert.ok(markIdx > createIdx);
  });
});
