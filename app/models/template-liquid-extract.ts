/**
 * Group 14 Phase C — partial Liquid → visual-config extraction.
 * Port of client `applyCodeToForm` in old template-editor.js.
 * Only maps what the old editor synced; unknown Liquid is left alone (no invention).
 */
import type { TemplateConfig } from "./template-config.types";

function stripAtRules(src: string): string {
  return String(src || "").replace(/@media[^{]*\{[\s\S]*?\}\s*/gi, "");
}

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "i");
  const match = css.match(re);
  return match ? match[1] : "";
}

function hasClassName(src: string, className: string): boolean {
  return new RegExp(`class=["'][^"']*\\b${className}\\b`, "i").test(src);
}

function toColorInput(value: string): string | null {
  const raw = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function firstColor(block: string): string | null {
  const match = block.match(/#[0-9A-Fa-f]{3,8}/);
  return match ? toColorInput(match[0]) : null;
}

function firstPx(block: string, prop: string): number | null {
  const re = new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i");
  const match = block.match(re);
  if (!match) return null;
  const n = Math.round(Number(match[1]));
  return Number.isFinite(n) ? n : null;
}

/**
 * Apply Liquid-derived visual hints onto a clone of `config`.
 * Returns the updated config (old editor mutated form controls then collectConfig).
 */
export function extractVisualConfigFromLiquid(
  liquidHtml: string,
  config: TemplateConfig,
): TemplateConfig {
  const next = structuredClone(config);
  const src = liquidHtml || "";
  const baseCss = stripAtRules(src);

  next.sections.lineItems.columns.quantity = /item\.quantity/.test(src);
  next.sections.lineItems.columns.unitPrice = /item\.unit_price/.test(src);
  next.sections.lineItems.columns.discount = /item\.discount/.test(src);
  next.sections.lineItems.columns.vatRate = /item\.vat_rate/.test(src);
  next.sections.lineItems.columns.lineTotal = /item\.line_total/.test(src);
  next.sections.lineItems.columns.sku = /item\.sku/.test(src);
  next.sections.lineItems.columns.productTitle = /item\.product_title/.test(src);
  next.sections.lineItems.columns.productImage = /item\.image_url/.test(src);
  next.sections.lineItems.columns.barcode = /item\.barcode_data_url/.test(src);

  next.sections.buyer.visible =
    /buyer\.name/.test(src) || /labels\.buyer/.test(src);
  next.sections.buyer.fields.email =
    /\{\{\s*buyer\.email/.test(src) ||
    /\{%\s*if\s+buyer\.email\s*%\}/.test(src);
  next.sections.buyer.fields.address =
    /\{\{\s*buyer\.address/.test(src) ||
    /\{%\s*if\s+buyer\.address\s*%\}/.test(src);

  next.sections.seller.fields.tradeLicence = /seller\.trade_licence/.test(src);
  next.sections.seller.fields.trn = /seller\.trn/.test(src);

  next.sections.totals.showSubtotal = /totals\.subtotal/.test(src);
  next.sections.totals.showDiscount = /totals\.discount/.test(src);
  next.sections.totals.showVat = /totals\.vat_total/.test(src);
  next.sections.totals.showShipping = /totals\.shipping/.test(src);
  next.sections.totals.showGrandTotal = /totals\.grand_total/.test(src);
  next.sections.totals.visible =
    /class="totals"/.test(src) || /totals\./.test(src);

  next.sections.qrCode = { visible: /qr_html/.test(src) };
  next.content.showNotes = /content\.note/.test(src);
  next.content.showTerms = /content\.terms/.test(src);
  next.layout.showTaxBadge = /class="tax-badge"/.test(src);

  const partiesBlock = cssBlock(baseCss, ".parties");
  if (/grid-template-columns:\s*1fr 1fr/.test(partiesBlock)) {
    next.layout.sellerBuyerLayout = "side-by-side";
  } else if (/grid-template-columns:\s*1fr\s*;/.test(partiesBlock)) {
    next.layout.sellerBuyerLayout = "stacked";
  }

  const customHeader = hasClassName(src, "meta-card") || hasClassName(src, "brand");
  if (!customHeader) {
    const headerDir = cssBlock(baseCss, ".header");
    next.layout.logoPosition = /flex-direction:\s*column/.test(headerDir)
      ? "center"
      : "left";
  }

  const headerBlock = cssBlock(baseCss, ".header");
  if (/class="stripe"/.test(src) || /div class="stripe"/.test(src)) {
    next.layout.headerStyle = "emirates";
  } else if (/background:\s*(#[0-9a-fA-F]{3,8}|rgb)/.test(headerBlock)) {
    next.layout.headerStyle = "banner";
  } else if (!customHeader) {
    next.layout.headerStyle = "minimal";
  }

  const grandBlock = cssBlock(baseCss, ".totals .grand");
  let primaryMatch = grandBlock.match(
    /border-top:\s*[\d.]+px solid\s*(#[0-9a-fA-F]{3,8})/,
  );
  let primary = primaryMatch ? toColorInput(primaryMatch[1]) : null;
  if (!primary) {
    const rootBlock = cssBlock(baseCss, ":root");
    const rootPrimary = rootBlock.match(/--primary:\s*(#[0-9a-fA-F]{3,8})/);
    primary = rootPrimary ? toColorInput(rootPrimary[1]) : null;
  }
  if (!primary && !customHeader) {
    const headerBg = headerBlock.match(/background:\s*(#[0-9a-fA-F]{3,8})/);
    primary = headerBg ? toColorInput(headerBg[1]) : null;
  }
  if (primary) next.branding.primaryColor = primary;

  const accentMatch = grandBlock.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,8})/);
  const accent =
    (accentMatch ? toColorInput(accentMatch[1]) : null) ||
    firstColor(cssBlock(baseCss, ".tax-badge"));
  if (accent) next.branding.accentColor = accent;

  const secondary =
    firstColor(cssBlock(baseCss, ".box h3")) ||
    firstColor(cssBlock(baseCss, ".party-heading"));
  if (secondary) next.branding.secondaryColor = secondary;

  const bodyBlock = cssBlock(baseCss, "body");
  const fontMatch = bodyBlock.match(/font-family:\s*([^,;]+)/);
  if (fontMatch) {
    const font = fontMatch[1].trim().replace(/['"]/g, "");
    const allowed = [
      "Inter",
      "Segoe UI",
      "Georgia",
      "Arial",
      "Times New Roman",
    ] as const;
    if ((allowed as readonly string[]).includes(font)) {
      next.typography.fontFamily = font as (typeof allowed)[number];
    }
  }

  const baseSize = firstPx(bodyBlock, "font-size");
  if (baseSize != null && baseSize >= 10 && baseSize <= 14) {
    next.typography.baseFontSize = baseSize;
  }
  const headingSize =
    firstPx(cssBlock(baseCss, "h1"), "font-size") ||
    firstPx(cssBlock(baseCss, ".document-title"), "font-size");
  if (headingSize != null && headingSize >= 18 && headingSize <= 32) {
    next.typography.headingFontSize = headingSize;
  }
  const labelSize =
    firstPx(cssBlock(baseCss, ".box h3"), "font-size") ||
    firstPx(cssBlock(baseCss, ".party-heading"), "font-size");
  if (labelSize != null && labelSize >= 9 && labelSize <= 12) {
    next.typography.labelFontSize = labelSize;
  }

  return next;
}

/** Old editor helper: keep invoice.number outputs unless already present. */
export function sourceHasInvoiceNumber(src: string): boolean {
  const body = String(src || "").replace(/<title[\s\S]*?<\/title>/i, "");
  return /\{\{\s*invoice\.number\s*\}\}|\{\{\s*invoice_number\s*\}\}/.test(body);
}

export function stripInvoiceNumberOutputs(src: string): string {
  return String(src || "")
    .replace(/<strong>\s*\{\{\s*invoice\.number\s*\}\}\s*<\/strong>/g, "")
    .replace(/\{\{\s*invoice\.number\s*\}\}/g, "")
    .replace(/\{\{\s*invoice_number\s*\}\}/g, "");
}
