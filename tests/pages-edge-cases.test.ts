import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  LOGO_INVALID_MESSAGE,
  getBrandingForShop,
  getBrandingInputForShop,
  isBrandingConfigured,
  sanitizeLogoUrl,
  saveBrandingForShop,
  saveSocialLinksForShop,
} from "../app/models/branding.server";
import {
  HelpContactError,
  buildContactEmailHtml,
  buildContactEmailText,
  getHelpPageLinks,
  isHelpSmtpConfigured,
  sendHelpContactEmail,
} from "../app/models/help-support.server";
import { encryptSecret } from "../app/utils/token-crypto";

const shops: string[] = [];
const storeCleanup: Array<{ merchantId: string; storeId: string; shop: string }> =
  [];

function shopName() {
  const shop = `edge-${randomUUID()}.myshopify.com`;
  shops.push(shop);
  return shop;
}

async function seedActiveStore(shop = shopName()) {
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
      currency: "USD",
    },
  });
  storeCleanup.push({ merchantId: merchant.id, storeId: store.id, shop });
  return { merchant, store, shop };
}

function dataUrl(type: string, targetBytes: number) {
  const payloadLength = Math.ceil((targetBytes * 4) / 3);
  return `data:image/${type};base64,${"A".repeat(payloadLength)}`;
}

after(async () => {
  for (const row of storeCleanup) {
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  const allShops = [...new Set([...shops, ...storeCleanup.map((r) => r.shop)])];
  if (allShops.length > 0) {
    await prisma.shopBranding.deleteMany({ where: { shop: { in: allShops } } });
  }
  await prisma.$disconnect();
});

describe("branding logo rules", () => {
  it("keeps http and https urls and drops everything else", () => {
    assert.equal(sanitizeLogoUrl(undefined), "");
    assert.equal(sanitizeLogoUrl("   "), "");
    assert.equal(
      sanitizeLogoUrl("  https://cdn.example.com/logo.png  "),
      "https://cdn.example.com/logo.png",
    );
    assert.equal(
      sanitizeLogoUrl('https://cdn.example.com/a"b.png'),
      "https://cdn.example.com/a%22b.png",
    );
    assert.equal(sanitizeLogoUrl("http://cdn.example.com/logo.png"), "http://cdn.example.com/logo.png");
    assert.equal(sanitizeLogoUrl("javascript:alert(1)"), "");
    assert.equal(sanitizeLogoUrl("ftp://cdn.example.com/logo.png"), "");
    assert.equal(sanitizeLogoUrl("/files/logo.png"), "");
    assert.equal(sanitizeLogoUrl("data:image/svg+xml;base64,AAAA"), "");
    assert.equal(sanitizeLogoUrl("data:image/png;charset=utf-8;base64,AAAA"), "");
    assert.equal(sanitizeLogoUrl("DATA:image/png;base64,AAAA"), "");
  });

  it("accepts png, jpeg, jpg, webp, and gif data urls under 500 KB", () => {
    for (const type of ["png", "jpeg", "jpg", "webp", "gif"]) {
      const url = dataUrl(type, 1000);
      assert.equal(sanitizeLogoUrl(url), url);
    }
    const atLimit = `data:image/png;base64,${"A".repeat(666_666)}`;
    const overLimit = `data:image/png;base64,${"A".repeat(666_667)}`;
    assert.equal(sanitizeLogoUrl(atLimit), atLimit);
    assert.equal(sanitizeLogoUrl(overLimit), "");
  });
});

describe("branding save and reload", () => {
  it("returns null when there is no active store", async () => {
    const shop = shopName();
    assert.equal(await getBrandingInputForShop(shop), null);
    assert.equal(await saveBrandingForShop(shop, { footerText: "Nope" }), null);
  });

  it("returns green defaults in memory on first visit without creating a row", async () => {
    const { shop } = await seedActiveStore();
    const branding = await getBrandingInputForShop(shop);
    assert.deepEqual(branding, {
      primaryColor: "#008060",
      secondaryColor: "#6d7175",
      accentColor: "#004c3f",
      logoUrl: "",
      footerText: "Thank you for your business",
    });

    const again = await getBrandingInputForShop(shop);
    assert.deepEqual(again, branding);
    assert.equal(await prisma.shopBranding.count({ where: { shop } }), 0);
  });

  it("survives two first visits at the same time without creating a row", async () => {
    const { shop } = await seedActiveStore();
    const [first, second] = await Promise.all([
      getBrandingInputForShop(shop),
      getBrandingInputForShop(shop),
    ]);
    assert.equal(first?.primaryColor, "#008060");
    assert.equal(second?.footerText, "Thank you for your business");
    assert.equal(await prisma.shopBranding.count({ where: { shop } }), 0);
  });

  it("shows stored install colors as the green defaults", async () => {
    const { shop } = await seedActiveStore();
    await prisma.shopBranding.create({
      data: {
        shop,
        primaryColor: "#1a1a2e",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
        logoUrl: "",
        footerText: "Thank you for your business",
      },
    });
    const branding = await getBrandingInputForShop(shop);
    assert.ok(branding);
    assert.equal(branding.primaryColor, "#008060");
    assert.equal(branding.secondaryColor, "#6d7175");
    assert.equal(branding.accentColor, "#004c3f");
  });

  it("keeps a public logo url after reload and does not share it with another shop", async () => {
    const { shop } = await seedActiveStore();
    const { shop: other } = await seedActiveStore();
    const saved = await saveBrandingForShop(shop, {
      logoUrl: " https://cdn.example.com/logo.png ",
      primaryColor: "#112233",
      secondaryColor: "#445566",
      accentColor: "#778899",
      footerText: "See you soon",
    });
    assert.ok(saved);
    assert.equal(saved.error, undefined);
    assert.equal(saved.branding.logoUrl, "https://cdn.example.com/logo.png");

    const reloaded = await getBrandingInputForShop(shop);
    assert.ok(reloaded);
    assert.equal(reloaded.logoUrl, "https://cdn.example.com/logo.png");
    assert.equal(reloaded.footerText, "See you soon");

    const isolated = await getBrandingInputForShop(other);
    assert.ok(isolated);
    assert.equal(isolated.logoUrl, "");
  });

  it("falls back when a color is missing, short, or an install default", async () => {
    const { shop } = await seedActiveStore();
    const saved = await saveBrandingForShop(shop, {
      primaryColor: " #1A1A2E ",
      secondaryColor: "#fff",
      accentColor: " #0F3460 ",
      footerText: "Kept",
    });
    assert.ok(saved);
    assert.equal(saved.branding.primaryColor, "#008060");
    assert.equal(saved.branding.secondaryColor, "#6d7175");
    assert.equal(saved.branding.accentColor, "#004c3f");
    assert.equal(saved.branding.footerText, "Kept");

    const unrelatedInstallColor = await saveBrandingForShop(shop, {
      accentColor: "#1A1A2E",
    });
    assert.ok(unrelatedInstallColor);
    assert.equal(unrelatedInstallColor.branding.accentColor, "#1A1A2E");

    const mixed = await saveBrandingForShop(shop, {
      primaryColor: " #AaBbCc ",
      secondaryColor: "",
      accentColor: "#004c3f",
    });
    assert.ok(mixed);
    assert.equal(mixed.branding.primaryColor, "#AaBbCc");
    assert.equal(mixed.branding.secondaryColor, "#6d7175");
  });

  it("uses the default footer when empty and cuts a long footer to 500", async () => {
    const { shop } = await seedActiveStore();
    const empty = await saveBrandingForShop(shop, { footerText: "   \n  " });
    assert.ok(empty);
    assert.equal(empty.branding.footerText, "Thank you for your business");

    const long = "x".repeat(501);
    const cut = await saveBrandingForShop(shop, { footerText: `  ${long}` });
    assert.ok(cut);
    assert.equal(cut.branding.footerText.length, 500);
    assert.equal(cut.branding.footerText, "x".repeat(500));

    const exact = await saveBrandingForShop(shop, { footerText: "y".repeat(500) });
    assert.ok(exact);
    assert.equal(exact.branding.footerText, "y".repeat(500));
  });

  it("rejects an oversized or invalid upload, keeps the other fields, and keeps the prior logo", async () => {
    const { shop } = await seedActiveStore();
    await saveBrandingForShop(shop, {
      logoUrl: "https://cdn.example.com/keep.png",
      footerText: "Before",
    });

    const rejected = await saveBrandingForShop(
      shop,
      {
        logoUrl: dataUrl("png", 500_001),
        primaryColor: "#123456",
        secondaryColor: "#654321",
        accentColor: "#abcdef",
        footerText: "After upload",
      },
      { logoUploadAttempted: true },
    );
    assert.ok(rejected);
    assert.equal(rejected.error, LOGO_INVALID_MESSAGE);
    assert.equal(rejected.branding.logoUrl, "https://cdn.example.com/keep.png");
    assert.equal(rejected.branding.primaryColor, "#123456");
    assert.equal(rejected.branding.footerText, "After upload");

    const stored = await getBrandingInputForShop(shop);
    assert.ok(stored);
    assert.equal(stored.logoUrl, "https://cdn.example.com/keep.png");
    assert.equal(stored.footerText, "After upload");

    const wrongType = await saveBrandingForShop(
      shop,
      { logoUrl: "data:image/svg+xml;base64,AAAA", footerText: "Still here" },
      { logoUploadAttempted: true },
    );
    assert.ok(wrongType);
    assert.equal(wrongType.error, LOGO_INVALID_MESSAGE);
    assert.equal(wrongType.branding.footerText, "Still here");
    assert.equal(wrongType.branding.logoUrl, "https://cdn.example.com/keep.png");
  });

  it("drops a bad pasted logo without the upload error and lets a file win over a url", async () => {
    const { shop } = await seedActiveStore();
    const pasted = await saveBrandingForShop(shop, {
      logoUrl: "javascript:alert(1)",
      footerText: "Pasted",
    });
    assert.ok(pasted);
    assert.equal(pasted.error, undefined);
    assert.equal(pasted.branding.logoUrl, "");

    const fileWins = await saveBrandingForShop(
      shop,
      {
        logoUrl: dataUrl("gif", 100),
        footerText: "File",
      },
      { logoUploadAttempted: true },
    );
    assert.ok(fileWins);
    assert.equal(fileWins.error, undefined);
    assert.match(fileWins.branding.logoUrl, /^data:image\/gif;base64,/);

    const invalidFileKeepsPrior = await saveBrandingForShop(
      shop,
      { logoUrl: "not-a-url" },
      { logoUploadAttempted: true },
    );
    assert.ok(invalidFileKeepsPrior);
    assert.equal(invalidFileKeepsPrior.error, LOGO_INVALID_MESSAGE);
    assert.match(invalidFileKeepsPrior.branding.logoUrl, /^data:image\/gif;base64,/);
  });
});

describe("isBrandingConfigured", () => {
  it("returns false for null and untouched install defaults", () => {
    assert.equal(isBrandingConfigured(null), false);
    assert.equal(
      isBrandingConfigured({
        logoUrl: "",
        footerText: "Thank you for your business",
        primaryColor: "#1a1a2e",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
      }),
      false,
    );
    assert.equal(
      isBrandingConfigured({
        logoUrl: null,
        footerText: "   ",
        primaryColor: "#1a1a2e",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
      }),
      false,
    );
  });

  it("returns true for logo, custom footer, or non-install colors", () => {
    assert.equal(
      isBrandingConfigured({ logoUrl: "https://cdn.example.com/logo.png" }),
      true,
    );
    assert.equal(
      isBrandingConfigured({ footerText: "Thanks for shopping" }),
      true,
    );
    assert.equal(
      isBrandingConfigured({
        primaryColor: "#008060",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
      }),
      true,
    );
    assert.equal(
      isBrandingConfigured({
        primaryColor: "#1a1a2e",
        secondaryColor: "#ABCDEF",
        accentColor: "#0f3460",
      }),
      true,
    );
    // Old compare is case-sensitive against lowercase install hex.
    assert.equal(
      isBrandingConfigured({
        primaryColor: "#1A1A2E",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
      }),
      true,
    );
  });
});

describe("getBrandingForShop", () => {
  it("returns null when the shop has no active store", async () => {
    const shop = shopName();
    assert.equal(await getBrandingForShop(shop), null);

    const { shop: inactiveShop, store } = await seedActiveStore();
    await prisma.store.update({
      where: { id: store.id },
      data: { status: "uninstalled" },
    });
    assert.equal(await getBrandingForShop(inactiveShop), null);
  });

  it("returns display defaults when the active store has no branding row", async () => {
    const { shop } = await seedActiveStore();
    const branding = await getBrandingForShop(shop);
    assert.deepEqual(branding, {
      primaryColor: "#008060",
      secondaryColor: "#6d7175",
      accentColor: "#004c3f",
      logoUrl: "",
      footerText: "Thank you for your business",
      socialLinks: { visible: false, links: [] },
    });
  });

  it("resolves stored branding and social links for an active store", async () => {
    const { shop } = await seedActiveStore();
    await prisma.shopBranding.create({
      data: {
        shop,
        primaryColor: "#1a1a2e",
        secondaryColor: "#16213e",
        accentColor: "#0f3460",
        logoUrl: "https://cdn.example.com/logo.png",
        footerText: "See you soon",
      },
    });
    await saveSocialLinksForShop(shop, {
      showOnInvoice: true,
      website: { label: "Site", url: "https://acme.test" },
    });

    const branding = await getBrandingForShop(shop);
    assert.ok(branding);
    assert.equal(branding.primaryColor, "#008060");
    assert.equal(branding.secondaryColor, "#6d7175");
    assert.equal(branding.accentColor, "#004c3f");
    assert.equal(branding.logoUrl, "https://cdn.example.com/logo.png");
    assert.equal(branding.footerText, "See you soon");
    assert.equal(branding.socialLinks.visible, true);
    assert.equal(branding.socialLinks.links.length, 1);
    assert.equal(branding.socialLinks.links[0]?.platform, "website");
    assert.equal(branding.socialLinks.links[0]?.url, "https://acme.test/");
  });
});

describe("help contact rules", () => {
  const valid = {
    name: "Jane Smith",
    phone: "",
    email: "jane@yourstore.com",
    subject: "Invoice help",
    message: "Line one\n\nLine two",
    shopDomain: "demo.myshopify.com",
  };

  it("rejects missing fields and a bad email before checking SMTP", async () => {
    await assert.rejects(
      () => sendHelpContactEmail({ ...valid, name: "   \n  " }),
      (error: unknown) =>
        error instanceof HelpContactError &&
        error.status === 400 &&
        error.message === "All fields are required and email must be valid.",
    );
    await assert.rejects(
      () => sendHelpContactEmail({ ...valid, email: "jane@store" }),
      (error: unknown) =>
        error instanceof HelpContactError &&
        error.status === 400 &&
        error.message === "Please enter a valid email address.",
    );
    await assert.rejects(
      () => sendHelpContactEmail({ ...valid, subject: "   " }),
      (error: unknown) => error instanceof HelpContactError && error.status === 400,
    );
    await assert.rejects(
      () => sendHelpContactEmail({ ...valid, message: " \n " }),
      (error: unknown) => error instanceof HelpContactError && error.status === 400,
    );
  });

  it("accepts a valid message and reports missing SMTP", async () => {
    const previous = {
      email: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS,
    };
    delete process.env.SMTP_EMAIL;
    delete process.env.SMTP_PASS;
    try {
      await assert.rejects(
        () =>
          sendHelpContactEmail({
            ...valid,
            name: "Ann\r\nBcc: evil@example.com",
            phone: " 555 \n 0100 ",
          }),
        (error: unknown) =>
          error instanceof HelpContactError &&
          error.status === 503 &&
          error.message ===
            "Email is not configured. Please set SMTP_EMAIL and SMTP_PASS, then try again.",
      );
    } finally {
      if (previous.email === undefined) delete process.env.SMTP_EMAIL;
      else process.env.SMTP_EMAIL = previous.email;
      if (previous.pass === undefined) delete process.env.SMTP_PASS;
      else process.env.SMTP_PASS = previous.pass;
    }
  });

  it("escapes the contact email and omits an empty phone", () => {
    const html = buildContactEmailHtml({
      ...valid,
      name: '<script>alert("x")</script>',
      email: "jane@yourstore.com",
    });
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Shop: demo\.myshopify\.com/);
    assert.match(html, /<br \/>/);

    const text = buildContactEmailText(valid);
    assert.equal(text.includes("Phone:"), false);
    assert.match(text, /Shop:\s+demo\.myshopify\.com/);
    assert.match(text, /Line one\n\nLine two/);

    const withPhone = buildContactEmailText({ ...valid, phone: "+971500000000" });
    assert.match(withPhone, /Phone:\s+\+971500000000/);
  });

  it("uses the same help links when env values are missing or have a trailing slash", () => {
    const previous = {
      supportMail: process.env.SUPPORT_MAIL,
      supportEmail: process.env.SUPPORT_EMAIL,
      helpCenter: process.env.HELP_CENTER_URL,
      schedule: process.env.HELP_SCHEDULE_URL,
    };
    delete process.env.SUPPORT_MAIL;
    delete process.env.SUPPORT_EMAIL;
    delete process.env.HELP_CENTER_URL;
    delete process.env.HELP_SCHEDULE_URL;
    try {
      const links = getHelpPageLinks();
      assert.equal(links.supportEmail, "sbhattti1212@gmail.com");
      assert.equal(links.helpCenterUrl, "https://e-invoicing-cg-user-guide-4zcr.vercel.app");
      assert.equal(links.appName, "PDF Invoice Generator CG");
      assert.match(links.scheduleUrl, /^mailto:sbhattti1212@gmail.com\?subject=/);
    } finally {
      restoreEnv("SUPPORT_MAIL", previous.supportMail);
      restoreEnv("SUPPORT_EMAIL", previous.supportEmail);
      restoreEnv("HELP_CENTER_URL", previous.helpCenter);
      restoreEnv("HELP_SCHEDULE_URL", previous.schedule);
    }

    process.env.HELP_CENTER_URL = "https://guide.example.com/";
    process.env.SUPPORT_MAIL = "help@example.com";
    try {
      const links = getHelpPageLinks();
      assert.equal(links.helpCenterUrl, "https://guide.example.com");
      assert.equal(links.supportEmail, "help@example.com");
    } finally {
      restoreEnv("HELP_CENTER_URL", previous.helpCenter);
      restoreEnv("SUPPORT_MAIL", previous.supportMail);
    }
  });

  it("reports SMTP as unconfigured when credentials are missing", () => {
    const previous = {
      email: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS,
    };
    delete process.env.SMTP_EMAIL;
    delete process.env.SMTP_PASS;
    try {
      assert.equal(isHelpSmtpConfigured(), false);
    } finally {
      restoreEnv("SMTP_EMAIL", previous.email);
      restoreEnv("SMTP_PASS", previous.pass);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
