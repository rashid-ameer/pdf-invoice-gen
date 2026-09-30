import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  OnboardingError,
  loadCompanySetup,
  saveCompanySetup,
} from "../app/models/onboarding.server";
import {
  parseSocialLinksFromForm,
  sanitizeSocialUrl,
  resolveSocialLinks,
} from "../app/models/social-links.server";
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
    await prisma.shopBranding.deleteMany({ where: { shop: row.shop } });
  }
  await prisma.$disconnect();
});

async function seedStore(currency = "AED") {
  const shop = `onboard-${randomUUID()}.myshopify.com`;
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
      currency,
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id, shop });
  return { merchant, store, shop };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    legalName: "Acme Trading LLC",
    tradeName: "Acme",
    vatStatus: "registered",
    trn: "100000000000003",
    tin: "",
    tradeLicence: "TL-1",
    addressLine1: "Street 1",
    addressLine2: "Floor 2",
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
    showSocialLinks: "on",
    socialWebsiteLabel: "Website",
    socialWebsiteUrl: "https://acme.test",
    socialInstagramLabel: "Instagram",
    socialInstagramUrl: "https://instagram.com/acme",
    ...overrides,
  };
}

describe("social link helpers", () => {
  it("sanitizes urls like the old service", () => {
    assert.equal(sanitizeSocialUrl("https://example.com/a"), "https://example.com/a");
    assert.equal(sanitizeSocialUrl("//example.com/x"), "https://example.com/x");
    assert.equal(sanitizeSocialUrl("javascript:alert(1)"), "");
    assert.equal(sanitizeSocialUrl("ftp://example.com"), "");
  });

  it("parses form fields and resolves visible links", () => {
    const parsed = parseSocialLinksFromForm({
      showSocialLinks: "on",
      socialWebsiteUrl: "https://acme.test",
      socialWebsiteLabel: "Site",
      socialXUrl: "not-a-url",
    });
    assert.equal(parsed.showOnInvoice, true);
    const resolved = resolveSocialLinks(parsed);
    assert.equal(resolved.visible, true);
    assert.equal(resolved.links.length, 1);
    assert.equal(resolved.links[0].platform, "website");
  });
});

describe("company setup load and save", () => {
  it("loads defaults when no legal entity exists", async () => {
    const { shop } = await seedStore("AED");
    const data = await loadCompanySetup(shop);
    assert.equal(data.settings.vatRate, "5");
    assert.equal(data.settings.invoicePrefix, "INV-");
    assert.equal(data.settings.creditNotePrefix, "CN-");
    assert.equal(data.settings.taxInclusive, false);
    assert.equal(data.legalEntity.vatStatus, "registered");
    assert.equal(data.legalEntity.country, "AE");
    assert.equal(data.socialLinks.showOnInvoice, false);
  });

  it("rejects missing required fields with old messages", async () => {
    const { shop } = await seedStore();
    await assert.rejects(
      () => saveCompanySetup(shop, validBody({ legalName: "" })),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.status, 400);
        assert.equal(
          err.message,
          "Please complete all required business identity and address fields.",
        );
        return true;
      },
    );
    await assert.rejects(
      () =>
        saveCompanySetup(
          shop,
          validBody({ vatStatus: "registered", trn: "" }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(
          err.message,
          "Tax registration number is required when your business is VAT registered.",
        );
        return true;
      },
    );
    await assert.rejects(
      () => saveCompanySetup(shop, validBody({ businessPhone: "" })),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.message, "Business phone is required.");
        return true;
      },
    );
  });

  it("returns store not found for unknown shop", async () => {
    await assert.rejects(
      () => saveCompanySetup("missing.myshopify.com", validBody()),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.status, 404);
        assert.equal(err.message, "Store not found");
        return true;
      },
    );
  });

  it("saves legal entity, settings, tax ids, social links and reloads", async () => {
    const { shop, store } = await seedStore("AED");
    const saved = await saveCompanySetup(shop, validBody());

    assert.equal(saved.legalEntity.legalName, "Acme Trading LLC");
    assert.equal(saved.legalEntity.trn, "100000000000003");
    assert.equal(saved.legalEntity.tin, "1000000000");
    assert.equal(saved.legalEntity.country, "AE");
    assert.equal(saved.settings.invoicePrefix, "INV-");
    assert.equal(saved.socialLinks.showOnInvoice, true);
    assert.equal(saved.socialLinks.website?.url, "https://acme.test/");

    const storeRow = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
    });
    assert.ok(storeRow.defaultLegalEntityId);

    const taxIds = await prisma.taxIdentifier.findMany({
      where: { legalEntityId: storeRow.defaultLegalEntityId! },
    });
    assert.equal(taxIds.length, 3);

    const reloaded = await loadCompanySetup(shop);
    assert.equal(reloaded.legalEntity.tradeLicence, "TL-1");
    assert.equal(reloaded.settings.vatRate, "5");
    assert.equal(reloaded.socialLinks.instagram?.url, "https://instagram.com/acme");
  });

  it("deletes tax identifiers when values are cleared", async () => {
    const { shop, store } = await seedStore();
    await saveCompanySetup(shop, validBody());
    await saveCompanySetup(
      shop,
      validBody({
        tradeLicence: "",
        tin: "1000000000",
      }),
    );

    const storeRow = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
    });
    const taxIds = await prisma.taxIdentifier.findMany({
      where: { legalEntityId: storeRow.defaultLegalEntityId! },
    });
    assert.equal(
      taxIds.some((row) => row.identifierType === "trade_licence"),
      false,
    );
    assert.equal(taxIds.some((row) => row.identifierType === "trn"), true);
    assert.equal(taxIds.some((row) => row.identifierType === "tin"), true);
  });

  it("derives not_registered when trn empty and status not registered", async () => {
    const { shop } = await seedStore();
    const saved = await saveCompanySetup(
      shop,
      validBody({
        vatStatus: "not_registered",
        trn: "",
        tin: "",
      }),
    );
    assert.equal(saved.legalEntity.vatStatus, "not_registered");
    assert.equal(saved.legalEntity.trn, "");
  });
});
