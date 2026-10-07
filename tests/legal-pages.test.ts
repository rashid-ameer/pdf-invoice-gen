/**
 * Group 17 Phase 3 — public legal pages (/privacy, /support, /install).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_NAME, SUPPORT_EMAIL } from "../app/constants/app";
import {
  legalHtmlResponse,
  renderInstallFromShopifyPage,
  renderPrivacyPage,
  renderSupportPage,
} from "../app/models/legal-pages.server";
import { loader as privacyLoader } from "../app/routes/privacy";
import { loader as supportLoader } from "../app/routes/support";
import { loader as installLoader } from "../app/routes/install";

function routeSource(name: string): string {
  return readFileSync(join(process.cwd(), "app/routes", name), "utf8");
}

describe("Group 17 Phase 3 — /privacy", () => {
  it("returns HTTP 200 HTML without authentication", async () => {
    const res = await privacyLoader();
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("Content-Type") ?? "",
      /text\/html/,
    );
    const html = await res.text();
    assert.match(html, /Privacy policy/);
    assert.match(html, /Data we collect/);
    assert.match(html, /How we use data/);
    assert.match(html, /Sharing/);
    assert.match(html, /Retention and deletion/);
    assert.match(html, /customers\/redact/);
    assert.match(html, /shop\/redact/);
    assert.match(html, /Accredited Service Provider|Resend/);
    assert.match(html, new RegExp(APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(SUPPORT_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /Last updated: 8 September 2026/);
    assert.match(html, /\/support/);
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("privacy.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
    assert.match(src, /renderPrivacyPage/);
  });
});

describe("Group 17 Phase 3 — /support", () => {
  it("returns HTTP 200 HTML with help guidance and privacy link", async () => {
    const res = await supportLoader();
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>Support<\/h1>/);
    assert.match(html, /Shopify admin/);
    assert.match(html, /Setup/);
    assert.match(html, /Email/);
    assert.match(html, /do not ask merchants to type a store URL/i);
    assert.match(html, new RegExp(SUPPORT_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /\/privacy/);
    assert.match(html, /Privacy policy/);
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("support.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
    assert.match(src, /renderSupportPage/);
  });
});

describe("Group 17 Phase 3 — /install", () => {
  it("returns HTTP 200 install guidance without a shop-domain form", async () => {
    const res = await installLoader();
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`Install ${APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(html, /Shopify App Store|Shopify admin/);
    assert.match(html, /cannot start installation from a store domain/i);
    assert.doesNotMatch(html, /<form[\s>]/i);
    assert.doesNotMatch(html, /name=["']shop["']/i);
    assert.doesNotMatch(html, /myshopify\.com.*input|input.*myshopify/i);
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("install.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
    assert.match(src, /renderInstallFromShopifyPage/);
  });
});

describe("Group 17 Phase 3 — legal HTML helpers", () => {
  it("legalHtmlResponse sets text/html charset", async () => {
    const res = legalHtmlResponse("<html>ok</html>");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  });

  it("render helpers are pure (no auth imports in module source wiring tests already cover routes)", () => {
    assert.match(renderPrivacyPage(), /Privacy policy/);
    assert.match(renderSupportPage(), /Support/);
    assert.match(renderInstallFromShopifyPage(), /Install/);
  });
});
