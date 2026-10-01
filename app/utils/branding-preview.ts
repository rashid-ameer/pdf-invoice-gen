/** Builds the sandboxed invoice branding live-preview document (srcDoc). */

const INTER_FONT_HREF =
  "https://cdn.shopify.com/static/fonts/inter/v4/styles.css";

export function buildBrandingPreviewSrcDoc({
  primaryColor,
  accentColor,
  logoSrc,
  footerText,
}: {
  primaryColor: string;
  accentColor: string;
  logoSrc: string;
  footerText: string;
}): string {
  const primary = escapeHtml(primaryColor);
  const accent = escapeHtml(accentColor);
  const footer = escapeHtml(
    footerText.trim() || "Thank you for your business",
  );
  const logo = logoSrc.trim();
  const logoBlock = logo
    ? `<div class="mock-logo-wrap has-logo"><img src="${escapeHtml(logo)}" alt="" /></div>`
    : `<div class="mock-logo-wrap placeholder" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="preconnect" href="https://cdn.shopify.com/" />
  <link rel="stylesheet" href="${INTER_FONT_HREF}" />
  <style>
    :root {
      --primary: ${primary};
      --accent: ${accent};
      --ink: #111827;
      --muted: #9ca3af;
      --body: #4b5563;
      --line: #f3f4f6;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.4;
      font-optical-sizing: auto;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      color: var(--ink);
    }
    .stage {
      padding: 14px;
      background: linear-gradient(180deg, #f3f4f6 0%, #eef1f4 100%);
      border-radius: 12px;
    }
    .invoice {
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
      box-shadow:
        0 4px 20px rgba(16, 24, 40, 0.1),
        0 0 0 1px rgba(16, 24, 40, 0.04);
    }
    .stripe {
      height: 4px;
      background: linear-gradient(90deg, var(--primary), var(--accent), var(--primary));
    }
    .header {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 14px 14px 10px;
    }
    .mock-logo-wrap {
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px dashed #c9cccf;
      background: #f6f6f7;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      color: #8c9196;
    }
    .mock-logo-wrap.has-logo {
      border: none;
      background: transparent;
    }
    .mock-logo-wrap img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }
    .heading { min-width: 0; }
    .title {
      margin: 0;
      font-size: 0.8125rem;
      font-weight: 800;
      line-height: 1.2;
      color: var(--primary);
    }
    .sub {
      margin: 2px 0 0;
      font-size: 0.6875rem;
      font-weight: 400;
      color: var(--muted);
      line-height: 1.3;
    }
    .trn {
      margin: 0 14px 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--primary);
      color: #fff;
      font-size: 0.625rem;
      font-weight: 700;
    }
    .table { padding: 0 14px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 0;
      font-size: 0.6875rem;
      font-weight: 400;
      color: var(--body);
      border-bottom: 1px solid var(--line);
    }
    .row.head {
      color: #fff;
      background: var(--primary);
      padding: 7px 10px;
      border-radius: 6px 6px 0 0;
      margin-top: 2px;
      border-bottom: none;
      font-weight: 600;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 10px 14px 6px;
      font-size: 0.6875rem;
      color: #6b7280;
      font-weight: 600;
    }
    .total {
      font-weight: 800;
      font-size: 0.875rem;
      color: var(--accent);
    }
    .footer {
      padding: 10px 14px 12px;
      font-size: 0.625rem;
      font-weight: 400;
      color: var(--muted);
      text-align: center;
      border-top: 1px solid var(--line);
      line-height: 1.4;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="stage">
    <article class="invoice" aria-label="Invoice branding preview">
      <div class="stripe"></div>
      <header class="header">
        ${logoBlock}
        <div class="heading">
          <p class="title">TAX INVOICE</p>
          <p class="sub">INV-00042 · USD</p>
        </div>
      </header>
      <div class="trn">Tax ID · 100000000000003</div>
      <div class="table">
        <div class="row head"><span>Item</span><span>Total</span></div>
        <div class="row"><span>Sample product</span><span>315.00</span></div>
        <div class="row"><span>Shipping</span><span>26.25</span></div>
      </div>
      <div class="total-row">
        <span>Amount due</span>
        <span class="total">341.25 USD</span>
      </div>
      <div class="footer">${footer}</div>
    </article>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
