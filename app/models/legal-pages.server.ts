/**
 * Group 17 Phase 3 — public legal HTML pages (old server/views/legal.ts parity).
 * No authentication, no database, no merchant data.
 */

import { APP_NAME } from "../constants/app";
import { SUPPORT_EMAIL, getPublicAppUrl } from "../constants/app.server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legalPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} – ${escapeHtml(APP_NAME)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f7; margin: 0; color: #202223; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 20px 72px; }
    .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 32px; }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    h2 { font-size: 1.05rem; margin: 28px 0 8px; }
    p, li { color: #4a4d51; line-height: 1.6; }
    ul { padding-left: 20px; }
    a { color: #005bd3; }
    .muted { color: #6d7175; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      ${body}
    </div>
  </div>
</body>
</html>`;
}

export function renderPrivacyPage(): string {
  const appUrl = getPublicAppUrl();
  return legalPage(
    "Privacy policy",
    `
      <h1>Privacy policy</h1>
      <p class="muted">${escapeHtml(APP_NAME)} (“the app”) is a Shopify embedded app that generates invoices, packing slips, credit notes, and related documents for merchants.</p>

      <h2>Data we collect</h2>
      <p>When a merchant installs the app, we store:</p>
      <ul>
        <li>Shop domain, store name, currency, and timezone</li>
        <li>Offline Shopify access tokens required to sync orders</li>
        <li>Order, customer, and address details needed to create tax documents (name, email, phone, shipping/billing address, line items, taxes, refunds)</li>
        <li>Merchant business details entered in Setup (legal name, tax IDs, contact information, branding, email templates)</li>
      </ul>
      <p>We do not process Shopify checkout payments and we do not sell merchant or customer data.</p>

      <h2>How we use data</h2>
      <ul>
        <li>Create, store, email, and print invoices and related documents</li>
        <li>Sync orders and refunds from Shopify</li>
        <li>Respond to Shopify mandatory privacy webhooks (customer data request, customer deletion, shop deletion)</li>
      </ul>

      <h2>Sharing</h2>
      <p>Document emails are sent through the merchant’s configured email provider (for example Resend) using the merchant’s from-address. If a merchant enables a third-party Accredited Service Provider for e-invoicing, invoice data is sent to that provider at the merchant’s request.</p>

      <h2>Retention and deletion</h2>
      <p>Data is kept while the app remains installed so merchants can access historical invoices. After uninstall we stop processing new orders. When Shopify sends a <code>customers/redact</code> webhook we anonymize that customer’s personal information in stored documents. When Shopify sends a <code>shop/redact</code> webhook we delete the shop’s data from our systems.</p>

      <h2>Contact</h2>
      <p>Privacy questions: email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a> or see the <a href="${escapeHtml(appUrl)}/support">support page</a>.</p>
      <p class="muted">Last updated: 8 September 2026</p>
    `,
  );
}

export function renderSupportPage(): string {
  const appUrl = getPublicAppUrl();
  return legalPage(
    "Support",
    `
      <h1>Support</h1>
      <p>${escapeHtml(APP_NAME)} is installed and opened from the Shopify admin. We do not ask merchants to type a store URL to install the app.</p>
      <h2>Get help</h2>
      <ul>
        <li>Open the app from <strong>Shopify admin → Apps → ${escapeHtml(APP_NAME)}</strong></li>
        <li>Use <strong>Setup</strong> to complete seller details before sending invoices</li>
        <li>Use <strong>Email</strong> to confirm your sending address and templates</li>
      </ul>
      <h2>Contact</h2>
      <p>Email us at <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a>.</p>
      <p class="muted">You can also use “Get support” on the Shopify App Store listing for ${escapeHtml(APP_NAME)}.</p>
      <p class="muted"><a href="${escapeHtml(appUrl)}/privacy">Privacy policy</a></p>
    `,
  );
}

export function renderInstallFromShopifyPage(): string {
  return legalPage(
    `Install ${APP_NAME}`,
    `
      <h1>Install ${escapeHtml(APP_NAME)}</h1>
      <p>This app must be installed from the Shopify App Store or from Shopify admin. We cannot start installation from a store domain entered on this page.</p>
      <p>After you install, open <strong>Apps → ${escapeHtml(APP_NAME)}</strong> in Shopify admin.</p>
    `,
  );
}

/** HTML response helper for public legal loaders. */
export function legalHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
