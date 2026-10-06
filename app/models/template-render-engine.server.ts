import { sanitizeLogoUrl } from "./branding.server";
import { buildSocialLinksHtml } from "./social-links.server";
import {
  buildVerificationQrHtml,
  type DocumentVerificationPayload,
} from "./verification-qr.server";
import { usesRichLineProductCell } from "./line-item-render.server";
import type { DocumentType } from "../types/index";
import type { BaseLayoutCode, TemplateConfig } from "./template-config.types";
import { applyLayoutCapabilityLocks, enforceComplianceLocks } from "./template-config.types";
import { sanitizeRichTextHtml, richTextHasContent } from "./rich-text.server";
import { DEFAULT_AR_LABELS } from "./template-i18n";
import {
  fillImportedTemplateHtml,
  type PaginationValidation,
} from "./template-import-stub.server";
import { formatRegionCountryDisplay } from "./address-format.server";
import { DEFAULT_CURRENCY } from "../constants/app";
import { renderLiquidTemplate } from "./template-liquid.server";

export interface TemplateRenderInvoiceData {
  invoiceNumber: string;
  orderNumber?: string;
  originalInvoiceNumber?: string;
  reason?: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  shippingMethod?: string;
  orderNote?: string;
  seller: {
    legalName: string;
    tradeName?: string;
    trn: string;
    tin?: string;
    tradeLicence: string;
    businessEmail?: string;
    businessPhone?: string;
    address: { line1: string; city: string; emirate: string; country?: string };
  };
  buyer: {
    name: string;
    legalName?: string;
    trn?: string;
    tin?: string;
    email: string;
    phone?: string;
    addressLine?: string;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    discount: string;
    vatRate: string;
    vatAmount: string;
    lineTotal: string;
    sku?: string;
    productTitle?: string;
    variantTitle?: string;
    imageUrl?: string;
    barcode?: string;
    barcodeDataUrl?: string;
    descriptionHtml?: string;
  }>;
  totals: {
    subtotal: string;
    discount: string;
    vatTotal: string;
    shipping: string;
    grandTotal: string;
    totalWithoutTax?: string;
    amountDue?: string;
  };
  verification?: DocumentVerificationPayload;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MATRIX_TITLE_BAR_FALLBACK = '#D6EAF5';

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
  const n = parseInt(raw, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function isLightBackground(hex: string): boolean {
  const lum = colorLuminance(hex);
  return lum !== null && lum >= 0.62;
}

function lightTitleBarBackground(accent: string, primary: string): string {
  if (isLightBackground(accent)) return accent;
  if (isLightBackground(primary)) return primary;
  return MATRIX_TITLE_BAR_FALLBACK;
}

function darkInkOnLightBar(primary: string): string {
  if (isLightBackground(primary)) return '#1E3A5F';
  return primary;
}

type LineTableColumnKey =
  | 'description'
  | 'sku'
  | 'quantity'
  | 'unitPrice'
  | 'vatRate'
  | 'vatAmount'
  | 'discount'
  | 'lineTotal';

function lineTableColumnEnabled(
  cols: TemplateConfig['sections']['lineItems']['columns'],
  key: LineTableColumnKey
): boolean {
  if (key === 'discount') return cols.discount !== false;
  if (key === 'vatAmount') return cols.vatAmount === true;
  return Boolean(cols[key as keyof typeof cols]);
}

function buildLayoutColgroup(
  config: TemplateConfig,
  columns: { key: LineTableColumnKey; weight: number }[]
): string {
  const cols = config.sections.lineItems.columns;
  const weights: number[] = [];
  for (const column of columns) {
    if (lineTableColumnEnabled(cols, column.key)) {
      weights.push(column.weight);
    }
  }
  if (!weights.length) return '';
  const total = weights.reduce((sum, value) => sum + value, 0);
  return `<colgroup>${weights
    .map((weight) => `<col style="width:${((weight / total) * 100).toFixed(2)}%" />`)
    .join('')}</colgroup>`;
}

function uniformGridTableBorderCss(tableSelector: string, borderColor = '#E5E7EB'): string {
  return `
    ${tableSelector} {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid ${borderColor};
    }
    ${tableSelector} th,
    ${tableSelector} td {
      border: 1px solid ${borderColor};
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `;
}

type LineTableDensityMode = 'comfortable' | 'dense' | 'compact';

function countLineTableColumns(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  let count = 0;
  if (cols.description) count++;
  if (cols.sku) count++;
  if (cols.quantity) count++;
  if (cols.unitPrice) count++;
  if (cols.vatRate) count++;
  if (cols.vatAmount) count++;
  if (cols.discount !== false) count++;
  if (cols.lineTotal) count++;
  return count;
}

function countLineTableNumericColumns(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  let count = 0;
  if (cols.sku) count++;
  if (cols.quantity) count++;
  if (cols.unitPrice) count++;
  if (cols.vatRate) count++;
  if (cols.vatAmount) count++;
  if (cols.discount !== false) count++;
  if (cols.lineTotal) count++;
  return count;
}

function resolveLineTableDensity(config: TemplateConfig): {
  mode: LineTableDensityMode;
  colCount: number;
} {
  const colCount = countLineTableColumns(config);
  const richProduct = usesRichLineProductCell(config);
  let mode: LineTableDensityMode = 'comfortable';
  if (colCount >= 6 || (colCount >= 5 && richProduct)) {
    mode = 'compact';
  } else if (colCount >= 4 || richProduct) {
    mode = 'dense';
  }
  return { mode, colCount };
}

function lineTableDensityWrapClass(prefix: string, mode: LineTableDensityMode): string {
  if (mode === 'compact') return `${prefix}-table-compact`;
  if (mode === 'dense') return `${prefix}-table-dense`;
  return '';
}

function lineTableHeaderLabel(label: string, mode: LineTableDensityMode): string {
  if (mode === 'comfortable') return label;
  const shortcuts: Record<string, string> = {
    'VAT %': 'VAT',
    'Disc %': 'Disc',
    Quantity: 'Qty',
    'Item description': 'Description',
    'Qty.': 'Qty',
  };
  return shortcuts[label] ?? label;
}

function lineTableTh(label: string, mode: LineTableDensityMode, className?: string): string {
  const text = lineTableHeaderLabel(label, mode);
  const cls = className ? ` class="${className}"` : '';
  return `<th${cls}>${text}</th>`;
}

function pushLineTableVatHeaders(
  headers: string[],
  cols: TemplateConfig['sections']['lineItems']['columns'],
  th: (label: string, className?: string) => string
): void {
  if (cols.vatRate) headers.push(th('VAT %', 'num'));
  if (cols.vatAmount) headers.push(th('VAT', 'num'));
}

function pushLineTableVatCells(
  cells: string[],
  cols: TemplateConfig['sections']['lineItems']['columns'],
  item: TemplateRenderInvoiceData['lineItems'][number],
  currency?: string
): void {
  if (cols.vatRate) cells.push(`<td class="num">${esc(String(item.vatRate ?? '0%'))}</td>`);
  if (cols.vatAmount) {
    const raw = String(item.vatAmount ?? '0.00').trim() || '0.00';
    const amount = currency ? `${raw} ${currency}` : raw;
    cells.push(`<td class="num">${esc(amount)}</td>`);
  }
}

function adaptiveLineTableColumnWeights(
  config: TemplateConfig,
  weights: { key: LineTableColumnKey; weight: number }[]
): { key: LineTableColumnKey; weight: number }[] {
  const numericCount = countLineTableNumericColumns(config);
  const descCap = numericCount >= 6 ? 30 : numericCount >= 5 ? 32 : numericCount >= 4 ? 36 : 42;
  const narrowBoost = numericCount >= 5 ? 2 : numericCount >= 4 ? 1 : 0;
  const narrowKeys: LineTableColumnKey[] = ['quantity', 'vatRate', 'discount', 'sku'];

  return weights.map((column) => {
    if (column.key === 'description') {
      return { ...column, weight: Math.min(column.weight, descCap) };
    }
    if (narrowBoost && narrowKeys.includes(column.key)) {
      return { ...column, weight: column.weight + narrowBoost };
    }
    if (column.key === 'lineTotal' && numericCount >= 5) {
      return { ...column, weight: column.weight + 1 };
    }
    return column;
  });
}

function layoutTableDensityCss(
  layoutClass: string,
  prefix: string,
  typography: TemplateConfig['typography'],
  gridClass?: string
): string {
  const tableSel = gridClass ? `table.${gridClass}` : 'table';
  const denseBody = Math.max(typography.labelFontSize, 10);
  const compactBody = Math.max(typography.labelFontSize - 1, 9);
  const denseHeader = Math.max(typography.labelFontSize - 1, 9);
  const compactHeader = Math.max(typography.labelFontSize - 2, 8);
  const denseWrap = `.${layoutClass} .${prefix}-table-dense ${tableSel}`;
  const compactWrap = `.${layoutClass} .${prefix}-table-compact ${tableSel}`;

  return `
    ${denseWrap} { font-size: ${denseBody}px; }
    ${denseWrap} thead th {
      font-size: ${denseHeader}px;
      letter-spacing: 0.04em;
      padding: 7px 5px;
      white-space: nowrap;
    }
    ${denseWrap} tbody td { padding: 7px 5px; }
    .${layoutClass} .${prefix}-table-dense .line-product-thumb-wrap { width: 34px; height: 34px; }
    .${layoutClass} .${prefix}-table-dense .line-product-row { gap: 8px; }
    ${compactWrap} { font-size: ${compactBody}px; }
    ${compactWrap} thead th {
      font-size: ${compactHeader}px;
      letter-spacing: 0.03em;
      padding: 5px 4px;
      white-space: nowrap;
    }
    ${compactWrap} tbody td { padding: 5px 4px; }
    .${layoutClass} .${prefix}-table-compact .line-product-thumb-wrap { width: 28px; height: 28px; }
    .${layoutClass} .${prefix}-table-compact .line-product-row { gap: 6px; }
  `;
}

function rich(html: string): string {
  return sanitizeRichTextHtml(html);
}

function hasText(value: string | undefined | null): value is string {
  return Boolean(value && String(value).trim());
}

function isZeroMoney(value: string | undefined | null): boolean {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw) return true;
  const n = Number(raw);
  return Number.isFinite(n) && n === 0;
}

function wrapIf(className: string, inner: string): string {
  return inner.trim() ? `<div class="${className}">${inner}</div>` : '';
}

function preferEnglishLabel(value: string): string {
  return value.split('/')[0]?.trim() || value;
}

function label(config: TemplateConfig, key: string, fallback: string): string {
  const en = preferEnglishLabel(config.labels[key] ?? fallback);
  const ar = config.translations?.labels?.[key] ?? DEFAULT_AR_LABELS[key] ?? en;

  if (config.language?.showBilingual) {
    return `<span class="label-en">${esc(en)}</span> <span class="label-ar" dir="rtl">${esc(ar)}</span>`;
  }
  if (config.language?.primary === 'ar') {
    return esc(ar);
  }
  return esc(en);
}

function normalizeLegacyPrimaryHtml(html: string, primary: 'en' | 'ar', fallbackHtml: string): string {
  if (!html) return fallbackHtml;
  if (primary === 'en') {
    const noTags = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/[\u0600-\u06FF]/.test(noTags) && /·/.test(noTags)) {
      const englishPart = noTags.split('·').pop()?.trim();
      if (englishPart && !/[\u0600-\u06FF]/.test(englishPart)) {
        return `<p>${esc(englishPart)}</p>`;
      }
    }
  }
  return html;
}

function richBlock(config: TemplateConfig, enHtml: string, arHtml: string): string {
  const primary = config.language?.primary === 'ar' ? 'ar' : 'en';
  const normalizedEnHtml = normalizeLegacyPrimaryHtml(enHtml, primary, enHtml);
  const en = rich(normalizedEnHtml);
  if (!config.language?.showBilingual) {
    return primary === 'ar' ? rich(arHtml || normalizedEnHtml) : en;
  }
  const ar = rich(arHtml);
  return `${en}<div class="bilingual-ar" dir="rtl">${ar}</div>`;
}

function docTitle(config: TemplateConfig): string {
  return richBlock(
    config,
    config.content.documentTitle.html,
    config.translations?.documentTitle?.html ?? ''
  );
}

function docSubtitle(config: TemplateConfig, suffix = ''): string {
  const block = richBlock(config, config.content.subtitle.html, config.translations?.subtitle?.html ?? '');
  if (!richTextHasContent(block)) return '';
  return suffix ? `${block} · ${esc(suffix)}` : block;
}

function docFooter(config: TemplateConfig): string {
  const text = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const html = `${richTextHasContent(text) ? text : ''}${social}`;
  return html.trim();
}

function pageDir(config: TemplateConfig): string {
  return config.language?.primary === 'ar' ? 'rtl' : 'ltr';
}

function pageLang(config: TemplateConfig): string {
  if (config.language?.showBilingual) return 'en';
  return config.language?.primary ?? 'en';
}

function buildMetaBlock(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const rows: string[] = [];

  if (documentType === 'credit_note' || documentType === 'refund_document') {
    rows.push(
      `<div class="label">${label(
        config,
        documentType === 'refund_document' ? 'refundDocumentNumber' : 'creditNoteNumber',
        documentType === 'refund_document' ? 'Refund Document' : 'Credit Note Number'
      )}</div><div class="value">${esc(data.invoiceNumber)}</div>`
    );
    if (data.originalInvoiceNumber) {
      rows.push(
        `<div class="label">${label(config, 'originalInvoice', 'Original Invoice')}</div><div class="value">${esc(data.originalInvoiceNumber)}</div>`
      );
    }
    if (data.orderNumber) {
      rows.push(
        `<div class="label">${label(config, 'orderNumber', 'Order Number')}</div><div class="value">${esc(data.orderNumber)}</div>`
      );
    }
  } else if (documentType === 'packing_slip' && data.orderNumber) {
    rows.push(
      `<div class="label">${label(config, 'orderNumber', 'Order Number')}</div><div class="value">${esc(data.orderNumber)}</div>`
    );
    rows.push(
      `<div class="label">${label(config, 'invoiceNumber', 'Invoice')}</div><div class="value">${esc(data.invoiceNumber)}</div>`
    );
  } else if (hasText(data.invoiceNumber)) {
    rows.push(
      `<div class="label">${label(config, 'invoiceNumber', 'Invoice Number')}</div><div class="value">${esc(data.invoiceNumber)}</div>`
    );
    if (hasText(data.orderNumber)) {
      rows.push(
        `<div class="label">${label(config, 'orderNumber', 'Order Number')}</div><div class="value">${esc(data.orderNumber)}</div>`
      );
    }
  }

  if (hasText(data.issueDate)) {
    rows.push(
      `<div class="label">${label(config, 'issueDate', 'Issue Date')}</div><div class="value">${esc(data.issueDate)}</div>`
    );
  }

  if (documentType === 'packing_slip' && data.shippingMethod) {
    rows.push(
      `<div class="label">${label(config, 'shippingMethod', 'Shipping Method')}</div><div class="value">${esc(data.shippingMethod)}</div>`
    );
  }

  if ((documentType === 'credit_note' || documentType === 'refund_document') && data.reason) {
    rows.push(
      `<div class="label">${label(
        config,
        'reason',
        documentType === 'refund_document' ? 'Refund Reason' : 'Reason'
      )}</div><div class="value">${esc(data.reason)}</div>`
    );
  }

  return rows.join('');
}

function buildLineItemHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Description</th>');
  if (cols.sku) headers.push('<th>SKU</th>');
  if (cols.quantity) headers.push('<th>Qty</th>');
  if (cols.unitPrice) headers.push('<th>Unit Price</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th>${label}</th>`);
  if (cols.discount !== false) headers.push('<th>Discount %</th>');
  if (cols.lineTotal) headers.push('<th>Total</th>');
  return headers.join('');
}

function buildDescriptionCell(config: TemplateConfig, item: TemplateRenderInvoiceData['lineItems'][number]): string {
  const rich = usesRichLineProductCell(config);
  if (rich && item.descriptionHtml) {
    return `<td class="line-product" data-col="description">${item.descriptionHtml}</td>`;
  }
  return `<td data-col="description">${esc(item.description)}</td>`;
}

function buildLineItemRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) {
        cells.push(buildDescriptionCell(config, item));
      }
      if (cols.sku) cells.push(`<td>${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td>${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td>${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td>${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const rows: string[] = [];
  const cur = esc(data.currency);

  if (t.showSubtotal) {
    rows.push(
      `<div><span>${label(config, 'subtotal', 'Subtotal')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<div><span>${label(config, 'discount', 'Discount')}</span><span>${data.totals.discount} ${cur}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div><span>${label(config, 'vatTotal', 'VAT Total')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<div class="grand"><span>${label(config, 'grandTotal', 'Grand Total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
    );
  }
  return `<div class="totals">${rows.join('')}</div>`;
}

function buildSellerBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.seller.visible) return '';
  const f = config.sections.seller.fields;
  const lines: string[] = [];
  if (f.legalName && hasText(data.seller.legalName)) {
    lines.push(`<p><strong>${esc(data.seller.legalName)}</strong></p>`);
  }
  if (f.tradeName && hasText(data.seller.tradeName)) {
    lines.push(`<p>${esc(data.seller.tradeName ?? '')}</p>`);
  }
  if (f.address) {
    const addr = [data.seller.address.line1, data.seller.address.city].filter((part) => hasText(part)).join(', ');
    if (addr) lines.push(`<p>${esc(addr)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tin && hasText(data.seller.tin)) {
    lines.push(`<p>${label(config, 'tin', 'TIN')}: ${esc(data.seller.tin ?? '')}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  if (f.businessEmail && hasText(data.seller.businessEmail)) {
    lines.push(`<p>${label(config, 'businessEmail', 'Email')}: ${esc(data.seller.businessEmail ?? '')}</p>`);
  }
  if (f.businessPhone && hasText(data.seller.businessPhone)) {
    lines.push(`<p>${label(config, 'businessPhone', 'Phone')}: ${esc(data.seller.businessPhone ?? '')}</p>`);
  }
  if (lines.length === 0 && !config.layout.showTaxBadge) return '';
  const badge = config.layout.showTaxBadge
    ? '<span class="tax-badge">Tax registered supplier</span>'
    : '';
  return `<div class="box seller-box"><h3>${label(config, 'seller', 'Seller')}</h3>${lines.join('')}${badge}</div>`;
}

function buildBuyerBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  const displayName = hasText(data.buyer.legalName) ? data.buyer.legalName : data.buyer.name;
  if (f.name && hasText(displayName)) lines.push(`<p><strong>${esc(displayName ?? '')}</strong></p>`);
  if (f.trn && hasText(data.buyer.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.buyer.trn ?? '')}</p>`);
  }
  if (f.tin && hasText(data.buyer.tin)) {
    lines.push(`<p>${label(config, 'tin', 'TIN')}: ${esc(data.buyer.tin ?? '')}</p>`);
  }
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (lines.length === 0) return '';
  return `<div class="box buyer-box"><h3>${label(config, 'buyer', 'Buyer')}</h3>${lines.join('')}</div>`;
}

function buildTermsAndNotes(config: TemplateConfig): string {
  const note =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html)
      ? `<div class="custom-note"><strong>Notes</strong>${rich(config.content.customNote.html)}</div>`
      : '';
  const terms =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html)
      ? `<div class="terms-block"><strong>Terms &amp; conditions</strong>${rich(config.content.terms.html)}</div>`
      : '';
  return `${note}${terms}`;
}

function buildFooterBlock(config: TemplateConfig): string {
  const footer = docFooter(config);
  return footer ? `<div class="footer">${footer}</div>` : '';
}

function buildOrderNote(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!data.orderNote?.trim()) return '';
  return `<div class="custom-note"><strong>${label(config, 'orderNote', 'Notes')}</strong><div>${esc(data.orderNote)}</div></div>`;
}

function buildVerificationBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  return buildVerificationQrHtml(config.sections.qrCode?.visible === true, data.verification);
}

function buildLogo(config: TemplateConfig): string {
  const logo = sanitizeLogoUrl(config.branding.logoUrl);
  if (!logo) return '';
  const align = config.layout.logoPosition === 'center' ? 'center' : 'left';
  return `<div class="logo-wrap" style="text-align:${align}"><img src="${logo}" alt="Logo" class="logo" /></div>`;
}

function baseStyles(config: TemplateConfig): string {
  const { branding, typography } = config;
  const partiesGrid =
    config.layout.sellerBuyerLayout === 'stacked' ? '1fr' : '1fr 1fr';

  return `
    :root {
      --primary: ${branding.primaryColor};
      --secondary: ${branding.secondaryColor};
      --accent: ${branding.accentColor};
    }
    * { box-sizing: border-box; }
    body {
      font-family: '${typography.fontFamily}', system-ui, sans-serif;
      font-size: ${typography.baseFontSize}px;
      margin: 0;
      padding: 10mm;
      color: #1a1a1a;
      background: #fff;
    }
    .logo { max-height: 48px; max-width: 180px; object-fit: contain; margin-bottom: 10px; }
    .document-title { font-size: ${typography.headingFontSize}px; margin: 0; color: var(--primary); }
    .document-subtitle { margin: 6px 0 0; color: #666; font-size: ${typography.baseFontSize}px; }
    .meta .label { font-size: ${typography.labelFontSize}px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
    .meta .value { font-size: ${Math.round(typography.baseFontSize * 1.3)}px; font-weight: 700; margin-bottom: 10px; }
    .parties { display: grid; grid-template-columns: ${partiesGrid}; gap: 24px; margin-bottom: 28px; }
    .box { background: #f8faf9; border-radius: 12px; padding: 18px; border: 1px solid #e8ecea; }
    .box h3 { margin: 0 0 10px; font-size: ${typography.labelFontSize}px; text-transform: uppercase; color: var(--primary); letter-spacing: 0.05em; }
    .box p { margin: 0 0 4px; line-height: 1.5; }
    .tax-badge { display: inline-block; margin-top: 10px; padding: 4px 10px; border-radius: 999px; background: #e3f1df; color: #108043; font-size: ${typography.labelFontSize}px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; font-size: ${typography.labelFontSize}px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; padding: 12px 10px; border-bottom: 2px solid var(--primary); }
    td { padding: 12px 10px; border-bottom: 1px solid #eee; }
    td.qty { font-weight: 700; font-size: ${Math.round(typography.baseFontSize * 1.15)}px; }
    td.line-product { min-width: 240px; padding-top: 10px; padding-bottom: 10px; vertical-align: middle; }
    .line-product-row { display: flex; align-items: center; gap: 14px; }
    .line-product-thumb-wrap {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      overflow: hidden;
      flex-shrink: 0;
      background: linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%);
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08), inset 0 0 0 1px rgba(16, 24, 40, 0.06);
    }
    .line-product-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
    .line-product-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
    .line-product-title {
      font-weight: 650;
      color: #111827;
      line-height: 1.25;
      letter-spacing: -0.015em;
    }
    .line-product-variant {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      background: #f3f4f6;
      color: #6b7280;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.3;
    }
    .line-barcode {
      display: inline-flex;
      margin-top: 2px;
      padding: 5px 7px 4px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid #eef1f4;
      box-shadow: 0 1px 1px rgba(16, 24, 40, 0.04);
    }
    .line-barcode-img {
      display: block;
      height: 34px;
      width: auto;
      max-width: 148px;
      image-rendering: pixelated;
    }
    .totals { margin-top: 24px; margin-left: auto; width: 320px; }
    .totals div { display: flex; justify-content: space-between; padding: 8px 0; }
    .totals .grand { font-size: ${Math.round(typography.baseFontSize * 1.4)}px; font-weight: 800; color: var(--accent); border-top: 2px solid var(--primary); padding-top: 12px; margin-top: 8px; }
    .custom-note, .terms-block { margin-top: 20px; padding: 14px; background: #fafbfb; border-radius: 8px; font-size: ${typography.baseFontSize}px; }
    .custom-note strong, .terms-block strong { display: block; margin-bottom: 6px; color: var(--primary); font-size: ${typography.labelFontSize}px; text-transform: uppercase; letter-spacing: 0.04em; }
    .footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: ${typography.labelFontSize}px; color: #777; text-align: center; }
    .verification-qr {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-top: 28px;
      padding: 14px 16px;
      border: 1px solid #e8ecea;
      border-radius: 12px;
      background: #fafbfb;
    }
    .verification-qr img { display: block; border-radius: 6px; }
    .verification-qr-caption { display: flex; flex-direction: column; gap: 4px; text-align: left; font-size: ${typography.labelFontSize}px; color: #555; }
    .verification-qr-caption strong { color: var(--primary); text-transform: uppercase; letter-spacing: 0.04em; font-size: ${typography.labelFontSize}px; }
    .verification-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; font-weight: 700; color: #333; }
    .social-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 16px; margin-top: 12px; }
    .social-link { display: inline-flex; align-items: center; gap: 6px; color: var(--primary); text-decoration: none; font-size: ${typography.labelFontSize}px; }
    .social-link:hover { text-decoration: underline; }
    .social-icon { display: inline-flex; width: 16px; height: 16px; flex-shrink: 0; }
    .social-icon svg { width: 16px; height: 16px; display: block; }
    .social-label { line-height: 1.2; }
    .bilingual-ar { margin-top: 4px; opacity: 0.9; }
    .label-ar { opacity: 0.85; font-size: 0.92em; }
    [dir="rtl"] .meta { text-align: left; }
    [dir="rtl"] .totals { margin-left: 0; margin-right: auto; }
    .banner { background: var(--primary); color: #fff; padding: 8mm 10mm; margin: -10mm -10mm 24px; }
    .banner .document-title { color: #fff; }
    .banner .document-subtitle { color: rgba(255,255,255,0.9); }
    .stripe { height: 6px; background: linear-gradient(90deg, var(--primary), var(--accent), var(--primary)); margin: -10mm -10mm 24px; }
    .trn-block { background: var(--primary); color: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; gap: 24px; }
    .meta { text-align: right; }
    .doc-page { page-break-after: always; break-after: page; }
    .doc-page:last-child { page-break-after: auto; break-after: auto; }
  `;
}

function canvasStyles(config: TemplateConfig): string {
  const { typography } = config;
  const stacked = config.layout.sellerBuyerLayout === 'stacked';
  const logoCenter = config.layout.logoPosition === 'center';
  return `
    .layout-canvas {
      margin: -10mm;
      padding: 9mm 8mm 8mm;
      background: #F3F4F6;
      color: #1F2937;
      min-height: calc(100% + 20mm);
    }
    .layout-canvas .canvas-sheet {
      background: #fff;
      border-radius: 14px;
      padding: 11mm 10mm 9mm;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .layout-canvas .canvas-brand-row {
      display: flex;
      align-items: ${logoCenter ? 'center' : 'flex-start'};
      justify-content: space-between;
      gap: 28px;
      margin-bottom: 28px;
      flex-direction: ${logoCenter ? 'column' : 'row'};
      text-align: ${logoCenter ? 'center' : 'left'};
    }
    .layout-canvas .canvas-brand {
      display: flex;
      flex-direction: ${logoCenter ? 'column' : 'row'};
      align-items: ${logoCenter ? 'center' : 'flex-start'};
      gap: 12px;
      min-width: 0;
    }
    .layout-canvas .logo-wrap { text-align: inherit; }
    .layout-canvas .logo { max-height: 44px; max-width: 160px; margin-bottom: 0; }
    .layout-canvas .canvas-kicker .document-title {
      font-size: ${typography.labelFontSize}px;
      font-weight: 650;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--secondary);
      margin: 0 0 4px;
    }
    .layout-canvas .canvas-kicker .document-title p { margin: 0; }
    .layout-canvas .canvas-brand-name {
      font-size: ${typography.headingFontSize}px;
      font-weight: 750;
      color: var(--primary);
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin: 0;
    }
    .layout-canvas .canvas-kicker .document-subtitle {
      margin: 6px 0 0;
      color: #6B7280;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-canvas .canvas-kicker .document-subtitle p { margin: 0; }
    .layout-canvas .canvas-brand .social-links {
      justify-content: ${logoCenter ? 'center' : 'flex-start'};
      margin-top: 10px;
      gap: 6px 14px;
    }
    .layout-canvas .canvas-brand .tax-badge {
      margin-top: 10px;
      background: #FFF7ED;
      color: var(--accent);
    }
    .layout-canvas .canvas-seller-meta {
      text-align: ${logoCenter ? 'center' : 'right'};
      font-size: ${typography.baseFontSize}px;
      line-height: 1.55;
      color: #4B5563;
      max-width: 260px;
    }
    .layout-canvas .canvas-seller-meta p { margin: 0; }
    .layout-canvas .canvas-seller-meta .trn-line { margin-top: 8px; color: #111827; }
    .layout-canvas .canvas-billing {
      display: grid;
      grid-template-columns: ${stacked ? '1fr' : '1.2fr 1fr auto'};
      gap: ${stacked ? '18px' : '28px'};
      align-items: start;
      margin: 0 0 22px;
      padding: 4px 0 8px;
    }
    .layout-canvas .canvas-col h3 {
      margin: 0 0 8px;
      font-size: ${typography.labelFontSize}px;
      font-weight: 650;
      color: #111827;
      letter-spacing: 0;
      text-transform: none;
    }
    .layout-canvas .canvas-col p { margin: 0 0 2px; line-height: 1.5; color: #4B5563; }
    .layout-canvas .canvas-col p strong { color: #111827; font-weight: 650; }
    .layout-canvas .canvas-col .label {
      font-size: ${typography.labelFontSize}px;
      font-weight: 650;
      color: #111827;
      margin-top: 10px;
    }
    .layout-canvas .canvas-col .label:first-child { margin-top: 0; }
    .layout-canvas .canvas-col .value {
      font-size: ${typography.baseFontSize}px;
      font-weight: 500;
      color: #4B5563;
      margin-bottom: 2px;
    }
    .layout-canvas .canvas-hero { text-align: ${stacked ? 'left' : 'right'}; min-width: 160px; }
    .layout-canvas .canvas-hero .hero-label {
      font-size: ${typography.labelFontSize}px;
      font-weight: 650;
      color: #111827;
      margin-bottom: 4px;
    }
    .layout-canvas .canvas-hero .hero-amount {
      font-size: ${Math.max(typography.headingFontSize + 4, 30)}px;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .layout-canvas .canvas-hero .hero-due {
      margin-top: 14px;
    }
    .layout-canvas .canvas-hero .hero-due .label { color: #111827; font-weight: 650; }
    .layout-canvas .canvas-hero .hero-due .value { color: #4B5563; font-weight: 500; }
    .layout-canvas .canvas-subject {
      margin: 0 0 18px;
      padding-bottom: 14px;
      color: #4B5563;
    }
    .layout-canvas .canvas-subject strong { color: #111827; font-weight: 650; }
    .layout-canvas table {
      margin-top: 0;
    }
    .layout-canvas th {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 650;
      color: #9CA3AF;
      border-bottom: 1px solid #E5E7EB;
      padding: 10px 8px 12px;
      background: transparent;
    }
    .layout-canvas th:first-child, .layout-canvas td:first-child { text-align: left; padding-left: 0; }
    .layout-canvas th:not(:first-child), .layout-canvas td:not(:first-child) { text-align: right; }
    .layout-canvas td {
      padding: 14px 8px;
      border-bottom: 1px solid #F3F4F6;
      color: #111827;
    }
    .layout-canvas td.qty { font-weight: 500; }
    .layout-canvas .totals {
      width: 280px;
      margin-top: 8px;
      padding-top: 8px;
    }
    .layout-canvas .totals div {
      padding: 6px 0;
      color: #4B5563;
    }
    .layout-canvas .totals .grand {
      color: #111827;
      font-size: ${typography.baseFontSize}px;
      font-weight: 750;
      border-top: 0;
      padding-top: 8px;
      margin-top: 4px;
    }
    .layout-canvas .canvas-thanks {
      margin-top: 36px;
      font-weight: 700;
      color: #111827;
    }
    .layout-canvas .canvas-thanks p { margin: 0; }
    .layout-canvas .custom-note, .layout-canvas .terms-block {
      background: #F9FAFB;
      border-radius: 10px;
    }
    .layout-canvas .verification-qr {
      background: #F9FAFB;
      border-color: #E5E7EB;
    }
    .layout-canvas .canvas-page-foot {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 8px 0;
      font-size: ${typography.labelFontSize}px;
      color: #9CA3AF;
    }
    [dir="rtl"] .layout-canvas .canvas-seller-meta,
    [dir="rtl"] .layout-canvas .canvas-hero { text-align: left; }
    [dir="rtl"] .layout-canvas th:first-child,
    [dir="rtl"] .layout-canvas td:first-child { text-align: right; padding-left: 8px; padding-right: 0; }
    [dir="rtl"] .layout-canvas th:not(:first-child),
    [dir="rtl"] .layout-canvas td:not(:first-child) { text-align: left; }
  `;
}

function buildCanvasSellerIdentity(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const f = config.sections.seller.fields;
  const name =
    config.sections.seller.visible !== false && f.legalName && hasText(data.seller.legalName)
      ? `<div class="canvas-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const badge = config.layout.showTaxBadge
    ? '<span class="tax-badge">Tax registered supplier</span>'
    : '';
  return `
    <div class="canvas-brand">
      ${buildLogo(config)}
      <div class="canvas-kicker">
        ${wrapIf('document-title', docTitle(config))}
        ${name}
        ${wrapIf('document-subtitle', docSubtitle(config))}
        ${badge}
        ${social}
      </div>
    </div>`;
}

function buildCanvasSellerAddress(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '';
  const f = config.sections.seller.fields;
  const lines: string[] = [];
  if (f.address) {
    const addr = [data.seller.address.line1, data.seller.address.city]
      .filter((part) => hasText(part))
      .join(', ');
    if (addr) lines.push(`<p>${esc(addr)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(data.seller.address.emirate)}</p>`);
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(
      `<p class="trn-line">${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`
    );
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  if (lines.length === 0) return '';
  return `<div class="canvas-seller-meta">${lines.join('')}</div>`;
}

function buildCanvasBuyerColumn(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  if (f.name && hasText(data.buyer.name)) lines.push(`<p><strong>${esc(data.buyer.name)}</strong></p>`);
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone !== false && hasText(data.buyer.phone)) {
    lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  }
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '';
  return `<div class="canvas-col">${`<h3>${label(config, 'buyer', 'Billed to')}</h3>`}${lines.join('')}</div>`;
}

function buildCanvasHero(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const showAmount = config.sections.totals.visible !== false && config.sections.totals.showGrandTotal !== false;
  const ofLabel =
    documentType === 'credit_note'
      ? 'Credit of'
      : documentType === 'refund_document'
        ? 'Refund of'
        : documentType === 'packing_slip'
          ? ''
          : 'Invoice of';
  const amount = showAmount && ofLabel
    ? `<div class="hero-label">${esc(ofLabel)} (${esc(data.currency)})</div>
       <div class="hero-amount">${esc(data.totals.grandTotal)}</div>`
    : '';
  const dueValue = hasText(data.dueDate) ? data.dueDate : data.issueDate;
  const due =
    documentType !== 'packing_slip' && hasText(dueValue)
      ? `<div class="hero-due"><div class="label">${label(config, 'dueDate', 'Due date')}</div><div class="value">${esc(dueValue ?? '')}</div></div>`
      : '';
  if (!amount && !due) return '';
  return `<div class="canvas-col canvas-hero">${amount}${due}</div>`;
}

function buildCanvasLineItemHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Item detail</th>');
  if (cols.sku) headers.push('<th>SKU</th>');
  if (cols.quantity) headers.push('<th>Qty</th>');
  if (cols.unitPrice) headers.push('<th>Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th>${label}</th>`);
  if (cols.discount !== false) headers.push('<th>Disc %</th>');
  if (cols.lineTotal) headers.push('<th>Amount</th>');
  return headers.join('');
}

function renderCanvasLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const headerInner = `
    ${buildCanvasSellerIdentity(config, data)}
    ${buildCanvasSellerAddress(config, data)}`;
  const header =
    config.layout.headerStyle === 'banner'
      ? `<div class="banner canvas-brand-row">${headerInner}</div>`
      : `<div class="canvas-brand-row">${headerInner}</div>`;

  const billing = `
    <div class="canvas-billing">
      ${buildCanvasBuyerColumn(config, data)}
      <div class="canvas-col">${buildMetaBlock(config, data, documentType)}</div>
      ${buildCanvasHero(config, data, documentType)}
    </div>`;

  const subject = hasText(data.orderNumber)
    ? `<div class="canvas-subject"><strong>Subject:</strong> Order ${esc(data.orderNumber ?? '')}</div>`
    : '';

  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildCanvasLineItemHeaders(config)}</tr></thead><tbody>${buildLineItemRows(config, data)}</tbody></table>`
    : '';

  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const thanksBlock = richTextHasContent(thanks) ? `<div class="canvas-thanks">${thanks}</div>` : '';

  const pageFootLeft =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html)
      ? 'Terms &amp; Conditions'
      : '';
  const pageFootRight = hasText(data.invoiceNumber)
    ? `${documentType === 'credit_note' ? 'Credit note' : documentType === 'refund_document' ? 'Refund' : documentType === 'packing_slip' ? 'Packing slip' : 'Invoice'} ${esc(data.invoiceNumber)}`
    : '';

  return `
    <div class="layout-canvas">
      ${config.layout.headerStyle === 'emirates' ? '<div class="stripe"></div>' : ''}
      <div class="canvas-sheet">
        ${header}
        ${billing}
        ${subject}
        ${tableSection}
        ${buildTotals(config, data)}
        ${thanksBlock}
        ${buildOrderNote(config, data)}
        ${buildTermsAndNotes(config)}
        ${buildVerificationBlock(config, data)}
      </div>
      ${
        pageFootLeft || pageFootRight
          ? `<div class="canvas-page-foot"><span>${pageFootLeft}</span><span>${pageFootRight}</span></div>`
          : ''
      }
    </div>`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const TEENS = [
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)] ?? '');
    if (rest % 10) parts.push(ONES[rest % 10] ?? '');
  }
  return parts.filter(Boolean).join(' ');
}

function numberToWords(n: number): string {
  if (n === 0) return 'Zero';
  const million = Math.floor(n / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (million) parts.push(`${belowThousand(million)} Million`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

function moneyToWords(raw: string, currency: string): string {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const code = (currency || DEFAULT_CURRENCY).trim().toUpperCase();
  return `${code} ${numberToWords(whole)} and ${String(cents).padStart(2, '0')}/100 Only.`;
}

function mixWithWhite(hex: string, primaryShare = 0.12): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return '#EFF6FF';
  const mix = (channel: number) => Math.round(channel * primaryShare + 255 * (1 - primaryShare));
  const r = mix(parseInt(raw.slice(0, 2), 16));
  const g = mix(parseInt(raw.slice(2, 4), 16));
  const b = mix(parseInt(raw.slice(4, 6), 16));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function tideStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const wash = mixWithWhite(branding.primaryColor, 0.11);
  return `
    .layout-tide {
      color: #1F2937;
    }
    .layout-tide .tide-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-tide .tide-brand { min-width: 0; }
    .layout-tide .logo-wrap { text-align: left; margin-bottom: 8px; }
    .layout-tide .logo { max-height: 48px; max-width: 120px; margin-bottom: 0; }
    .layout-tide .tide-brand-name {
      font-size: ${typography.headingFontSize}px;
      font-weight: 700;
      color: var(--primary);
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin: 0;
    }
    .layout-tide .tide-origin {
      text-align: right;
      color: #6B7280;
      line-height: 1.5;
    }
    .layout-tide .tide-origin p { margin: 0; }
    .layout-tide .tide-intro {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      gap: 28px;
      align-items: start;
      margin: 0 0 28px;
    }
    .layout-tide .tide-label {
      color: #9CA3AF;
      font-size: ${typography.labelFontSize}px;
      font-weight: 400;
      margin: 0 0 4px;
    }
    .layout-tide .tide-value {
      color: #111827;
      font-weight: 700;
      line-height: 1.35;
    }
    .layout-tide .tide-muted {
      color: #6B7280;
      font-weight: 400;
      margin-top: 2px;
      line-height: 1.5;
    }
    .layout-tide .tide-meta {
      display: grid;
      grid-template-columns: auto 1fr 1fr;
      gap: 18px;
      align-items: start;
    }
    .layout-tide .tide-date-chip {
      background: ${wash};
      border-radius: 10px;
      padding: 10px 14px;
      min-width: 132px;
    }
    .layout-tide table { margin-top: 0; margin-bottom: 0; }
    .layout-tide th {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 500;
      color: #6B7280;
      border-bottom: 1px solid #E5E7EB;
      padding: 10px 12px 12px;
      background: transparent;
    }
    .layout-tide td {
      padding: 12px;
      border-bottom: 1px solid #F3F4F6;
      color: #111827;
    }
    .layout-tide th:first-child, .layout-tide td:first-child { padding-left: 0; text-align: left; }
    .layout-tide th.num, .layout-tide td.num {
      background: ${wash};
      text-align: right;
    }
    .layout-tide th.qty, .layout-tide td.qty { text-align: center; font-weight: 500; }
    .layout-tide tbody tr:last-child td { border-bottom: 0; }
    .layout-tide .tide-foot-spacer {
      background: transparent;
      border-bottom: 0;
      padding: 0;
    }
    .layout-tide td.tide-foot-summary {
      background: ${wash};
      border-bottom: 0;
      padding: 8px 14px 14px;
      border-radius: 0 0 12px 12px;
      vertical-align: top;
      text-align: left;
    }
    .layout-tide .tide-summary {
      width: 100%;
      margin: 0;
      background: transparent;
      padding: 0;
    }
    .layout-tide .tide-summary .totals {
      width: 100%;
      margin: 0;
    }
    .layout-tide .tide-summary .totals div {
      padding: 6px 0;
      color: #4B5563;
    }
    .layout-tide .tide-summary .totals .grand { display: none; }
    .layout-tide .tide-total-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0 8px;
      color: #111827;
      font-weight: 600;
    }
    .layout-tide .tide-due {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      padding: 10px 14px;
      background: var(--primary);
      color: #fff;
      border-radius: 10px;
      font-weight: 700;
    }
    .layout-tide .tide-words {
      margin-top: 10px;
      text-align: center;
      color: #9CA3AF;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-tide .tide-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-top: 36px;
      padding-top: 14px;
      border-top: 1px solid #E5E7EB;
    }
    .layout-tide .tide-thanks { font-weight: 700; color: #111827; }
    .layout-tide .tide-thanks p { margin: 0; }
    .layout-tide .tide-footer .social-links { justify-content: flex-end; margin-top: 0; }
    .layout-tide .tide-footer .social-link { color: #6B7280; }
    .layout-tide > .tide-summary {
      width: 48%;
      margin-left: auto;
      background: ${wash};
      padding: 8px 14px 14px;
      border-radius: 12px;
    }
    .layout-tide .custom-note, .layout-tide .terms-block { background: #F9FAFB; border-radius: 10px; }
    [dir="rtl"] .layout-tide .tide-origin { text-align: left; }
    [dir="rtl"] .layout-tide th.num, [dir="rtl"] .layout-tide td.num { text-align: left; }
  `;
}

function buildTideOrigin(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '';
  const f = config.sections.seller.fields;
  const lines: string[] = [];
  if (f.address && hasText(data.seller.address.city)) {
    lines.push(`<p>${esc(data.seller.address.city)}</p>`);
  } else if (f.address && hasText(data.seller.address.line1)) {
    lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  if (lines.length === 0) return '';
  return `<div class="tide-origin">${lines.join('')}</div>`;
}

function buildTideBilledTo(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const body: string[] = [];
  if (f.name && hasText(data.buyer.name)) {
    body.push(`<div class="tide-value">${esc(data.buyer.name)}</div>`);
  }
  if (f.address && hasText(data.buyer.addressLine)) {
    body.push(`<div class="tide-muted">${esc(data.buyer.addressLine ?? '')}</div>`);
  }
  if (f.phone !== false && hasText(data.buyer.phone)) {
    body.push(`<div class="tide-muted">${esc(data.buyer.phone ?? '')}</div>`);
  }
  if (f.email && hasText(data.buyer.email)) {
    body.push(`<div class="tide-muted">${esc(data.buyer.email)}</div>`);
  }
  if (body.length === 0) return '';
  return `<div class="tide-billed">
    <div class="tide-label">${label(config, 'buyer', 'Billed to')}</div>
    ${body.join('')}
  </div>`;
}

function buildTideMeta(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const numberLabel =
    documentType === 'credit_note'
      ? label(config, 'creditNoteNumber', 'Credit note number')
      : documentType === 'refund_document'
        ? label(config, 'refundDocumentNumber', 'Refund document')
        : label(config, 'invoiceNumber', 'Invoice number');
  const dateChip = hasText(data.issueDate)
    ? `<div class="tide-date-chip">
        <div class="tide-label">${label(config, 'issueDate', 'Invoice date')}</div>
        <div class="tide-value">${esc(data.issueDate)}</div>
      </div>`
    : '<div></div>';
  const number = hasText(data.invoiceNumber)
    ? `<div>
        <div class="tide-label">${numberLabel}</div>
        <div class="tide-value">${esc(data.invoiceNumber)}</div>
      </div>`
    : '<div></div>';
  const reference = hasText(data.orderNumber)
    ? `<div>
        <div class="tide-label">${label(config, 'orderNumber', 'Reference')}</div>
        <div class="tide-value">${esc(data.orderNumber)}</div>
      </div>`
    : hasText(data.originalInvoiceNumber)
      ? `<div>
          <div class="tide-label">${label(config, 'originalInvoice', 'Original invoice')}</div>
          <div class="tide-value">${esc(data.originalInvoiceNumber)}</div>
        </div>`
      : '<div></div>';
  return `<div class="tide-meta">${dateChip}${number}${reference}</div>`;
}

function buildTideHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Item description</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.quantity) headers.push('<th class="num qty">Qty</th>');
  if (cols.unitPrice) headers.push('<th class="num">Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Amount</th>');
  return headers.join('');
}

function buildTideRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) {
        cells.push(buildDescriptionCell(config, item));
      }
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="num qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function tideNumericColumnCount(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  return [
    cols.sku,
    cols.quantity,
    cols.unitPrice,
    cols.vatRate,
    cols.vatAmount,
    cols.discount !== false,
    cols.lineTotal,
  ].filter(Boolean).length;
}

function buildTideDueBar(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  if (documentType === 'packing_slip') return '';
  if (config.sections.totals.visible === false || config.sections.totals.showGrandTotal === false) {
    return '';
  }
  const dueLabel =
    documentType === 'credit_note'
      ? 'Credit due'
      : documentType === 'refund_document'
        ? 'Refund due'
        : label(config, 'grandTotal', 'Total due');
  return `<div class="tide-total-line"><span>Total</span><span>${esc(data.totals.grandTotal)} ${esc(data.currency)}</span></div>
    <div class="tide-due"><span>${dueLabel}</span><span>${esc(data.currency)} ${esc(data.totals.grandTotal)}</span></div>
    <div class="tide-words">${esc(moneyToWords(data.totals.grandTotal, data.currency))}</div>`;
}

function renderTideLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const name =
    config.sections.seller.visible !== false &&
    config.sections.seller.fields.legalName &&
    hasText(data.seller.legalName)
      ? `<div class="tide-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const summaryInner = showPrices
    ? `<div class="tide-summary">${buildTotals(config, data)}${buildTideDueBar(config, data, documentType)}</div>`
    : '';
  const numCols = tideNumericColumnCount(config);
  const hasDesc = Boolean(config.sections.lineItems.columns.description);
  const tableFoot =
    showPrices && numCols > 0
      ? `<tfoot><tr>${hasDesc ? '<td class="tide-foot-spacer"></td>' : ''}<td class="tide-foot-summary" colspan="${numCols}">${summaryInner}</td></tr></tfoot>`
      : '';
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildTideHeaders(config)}</tr></thead><tbody>${buildTideRows(config, data)}</tbody>${tableFoot}</table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  return `
    <div class="layout-tide">
      <div class="tide-header">
        <div class="tide-brand">
          ${buildLogo(config)}
          ${name}
        </div>
        ${buildTideOrigin(config, data)}
      </div>
      <div class="tide-intro">
        ${buildTideBilledTo(config, data)}
        ${buildTideMeta(config, data, documentType)}
      </div>
      ${tableSection}
      ${!config.sections.lineItems.visible && summaryInner ? summaryInner : ''}
      ${buildOrderNote(config, data)}
      ${buildTermsAndNotes(config)}
      ${buildVerificationBlock(config, data)}
      <div class="tide-footer">
        ${richTextHasContent(thanks) ? `<div class="tide-thanks">${thanks}</div>` : '<div></div>'}
        ${social}
      </div>
    </div>`;
}

function folioStyles(config: TemplateConfig): string {
  const { typography } = config;
  return `
    .layout-folio {
      margin: -10mm;
      padding: 8mm;
      background: #F3F4F6;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-folio .folio-sheet {
      background: #fff;
      border-radius: 2px;
      padding: 12mm 11mm 10mm;
      min-height: 245mm;
    }
    .layout-folio .folio-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
      align-items: start;
      margin-bottom: 20px;
    }
    .layout-folio .folio-title,
    .layout-folio .folio-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.05;
      color: #111827;
      margin: 0 0 20px;
    }
    .layout-folio .folio-title p { margin: 0; }
    .layout-folio .folio-billed-label {
      font-weight: 700;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-folio .folio-billed-name { font-weight: 400; line-height: 1.45; }
    .layout-folio .folio-billed-muted {
      color: #4B5563;
      line-height: 1.5;
      margin-top: 2px;
    }
    .layout-folio .folio-brand { text-align: right; }
    .layout-folio .folio-brand .logo-wrap { text-align: right; margin-bottom: 10px; }
    .layout-folio .folio-brand .logo {
      max-height: 52px;
      max-width: 72px;
      margin: 0 0 0 auto;
      display: block;
    }
    .layout-folio .folio-brand-name {
      color: var(--primary);
      font-weight: 700;
      margin: 0 0 6px;
      line-height: 1.3;
    }
    .layout-folio .folio-origin { color: #6B7280; line-height: 1.5; }
    .layout-folio .folio-origin p { margin: 0; }
    .layout-folio .folio-rule {
      border: 0;
      border-top: 1px solid #E5E7EB;
      margin: 0 0 28px;
    }
    .layout-folio .folio-body {
      display: grid;
      grid-template-columns: 148px minmax(0, 1fr);
      gap: 32px;
      align-items: start;
    }
    .layout-folio .folio-rail { display: flex; flex-direction: column; gap: 18px; padding-top: 6px; }
    .layout-folio .folio-kicker {
      font-weight: 700;
      font-size: ${typography.labelFontSize}px;
      margin: 0 0 4px;
      color: #111827;
    }
    .layout-folio .folio-meta-value { color: #111827; line-height: 1.4; }
    .layout-folio .folio-card {
      border: 1px solid #E5E7EB;
      border-radius: 16px;
      padding: 16px 18px 14px;
    }
    .layout-folio .folio-card table { margin: 0; }
    .layout-folio .folio-card th {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 700;
      color: #111827;
      border-bottom: 1px solid #E5E7EB;
      background: transparent;
      padding: 6px 10px 12px;
    }
    .layout-folio .folio-card td {
      border-bottom: 1px solid #F3F4F6;
      padding: 12px 10px;
      color: #111827;
    }
    .layout-folio .folio-card th:first-child,
    .layout-folio .folio-card td:first-child { padding-left: 2px; text-align: left; }
    .layout-folio .folio-card th.num,
    .layout-folio .folio-card td.num { text-align: right; }
    .layout-folio .folio-card th.qty,
    .layout-folio .folio-card td.qty { text-align: center; font-weight: 500; }
    .layout-folio .folio-card tbody tr:last-child td { border-bottom: 1px solid #E5E7EB; }
    .layout-folio .folio-card .totals {
      width: auto;
      min-width: 220px;
      margin: 10px 0 0 auto;
    }
    .layout-folio .folio-card .totals div {
      padding: 6px 0;
      color: #111827;
    }
    .layout-folio .folio-card .totals .grand {
      color: var(--primary);
      font-size: ${Math.round(typography.baseFontSize * 1.15)}px;
      font-weight: 700;
      border-top: 1px solid #E5E7EB;
      margin-top: 4px;
      padding-top: 10px;
    }
    .layout-folio .folio-thanks {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 36px;
      color: #9CA3AF;
    }
    .layout-folio .folio-thanks p { margin: 0; color: inherit; font-weight: 400; }
    .layout-folio .folio-thanks-icon { flex-shrink: 0; display: block; }
    .layout-folio .folio-url {
      margin-top: 28px;
      text-align: center;
      color: #D1D5DB;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-folio .custom-note, .layout-folio .terms-block { background: #F9FAFB; border-radius: 10px; }
    [dir="rtl"] .layout-folio .folio-brand { text-align: left; }
    [dir="rtl"] .layout-folio .folio-brand .logo-wrap { text-align: left; }
    [dir="rtl"] .layout-folio .folio-brand .logo { margin: 0 auto 0 0; }
    [dir="rtl"] .layout-folio .folio-card th.num,
    [dir="rtl"] .layout-folio .folio-card td.num { text-align: left; }
  `;
}

const FOLIO_THANKS_ICON = `<svg class="folio-thanks-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.25 2.5h9.5A1.75 1.75 0 0 1 14.5 4.25v5.5a1.75 1.75 0 0 1-1.75 1.75H8.31l-3.07 2.3A.75.75 0 0 1 4 13.25V11.5H3.25A1.75 1.75 0 0 1 1.5 9.75v-5.5A1.75 1.75 0 0 1 3.25 2.5Z"/></svg>`;

function folioWebsiteLine(config: TemplateConfig): string {
  const site = (config.socialLinks?.links ?? []).find((link) => link.platform === 'website' && link.url);
  if (!site?.url) return '';
  let display = site.label?.trim() || '';
  try {
    const parsed = new URL(site.url);
    display = parsed.host.replace(/^www\./i, '');
  } catch {
    display = display || site.url;
  }
  return display ? `<div class="folio-url">${esc(display)}</div>` : '';
}

function buildFolioOrigin(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '';
  const f = config.sections.seller.fields;
  const lines: string[] = [];
  if (f.address && hasText(data.seller.address.city)) {
    lines.push(`<p>${esc(data.seller.address.city)}</p>`);
  } else if (f.address && hasText(data.seller.address.line1)) {
    lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  if (lines.length === 0) return '';
  return `<div class="folio-origin">${lines.join('')}</div>`;
}

function buildFolioBilledTo(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const body: string[] = [];
  if (f.name && hasText(data.buyer.name)) {
    body.push(`<div class="folio-billed-name">${esc(data.buyer.name)}</div>`);
  }
  if (f.address && hasText(data.buyer.addressLine)) {
    body.push(`<div class="folio-billed-muted">${esc(data.buyer.addressLine ?? '')}</div>`);
  }
  if (f.phone && hasText(data.buyer.phone)) {
    body.push(`<div class="folio-billed-muted">${esc(data.buyer.phone ?? '')}</div>`);
  }
  if (f.email && hasText(data.buyer.email)) {
    body.push(`<div class="folio-billed-muted">${esc(data.buyer.email)}</div>`);
  }
  if (body.length === 0) return '';
  return `<div class="folio-billed">
    <div class="folio-billed-label">${label(config, 'buyer', 'Billed to')}</div>
    ${body.join('')}
  </div>`;
}

function folioMetaItem(kicker: string, value: string | undefined): string {
  if (!hasText(value)) return '';
  return `<div class="folio-meta-item">
    <div class="folio-kicker">${kicker}</div>
    <div class="folio-meta-value">${esc(value ?? '')}</div>
  </div>`;
}

function buildFolioRail(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const numberLabel =
    documentType === 'credit_note'
      ? label(config, 'creditNoteNumber', 'Credit note #')
      : documentType === 'refund_document'
        ? label(config, 'refundDocumentNumber', 'Refund #')
        : label(config, 'invoiceNumber', 'Invoice #');
  const items = [
    folioMetaItem(numberLabel, data.invoiceNumber),
    folioMetaItem(label(config, 'issueDate', 'Invoice date'), data.issueDate),
    folioMetaItem(label(config, 'orderNumber', 'Reference'), data.orderNumber),
    folioMetaItem(label(config, 'dueDate', 'Due date'), data.dueDate),
  ];
  if (hasText(data.originalInvoiceNumber)) {
    items.push(folioMetaItem(label(config, 'originalInvoice', 'Original invoice'), data.originalInvoiceNumber));
  }
  return `<div class="folio-rail">${items.join('')}</div>`;
}

function buildFolioHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Services</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.quantity) headers.push('<th class="num qty">Qty</th>');
  if (cols.unitPrice) headers.push('<th class="num">Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Line total</th>');
  return headers.join('');
}

function buildFolioRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="num qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function renderFolioLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const name =
    config.sections.seller.visible !== false &&
    config.sections.seller.fields.legalName &&
    hasText(data.seller.legalName)
      ? `<div class="folio-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildFolioHeaders(config)}</tr></thead><tbody>${buildFolioRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');

  return `
    <div class="layout-folio">
      <div class="folio-sheet">
        <div class="folio-header">
          <div class="folio-header-left">
            ${title ? `<div class="folio-title">${title}</div>` : ''}
            ${buildFolioBilledTo(config, data)}
          </div>
          <div class="folio-brand">
            ${buildLogo(config)}
            ${name}
            ${buildFolioOrigin(config, data)}
          </div>
        </div>
        <hr class="folio-rule" />
        <div class="folio-body">
          ${buildFolioRail(config, data, documentType)}
          <div class="folio-card">
            ${tableSection}
            ${showPrices ? buildTotals(config, data) : ''}
          </div>
        </div>
        ${buildOrderNote(config, data)}
        ${buildTermsAndNotes(config)}
        ${buildVerificationBlock(config, data)}
        ${
          richTextHasContent(thanks)
            ? `<div class="folio-thanks">${FOLIO_THANKS_ICON}<div>${thanks}</div></div>`
            : ''
        }
        ${folioWebsiteLine(config)}
      </div>
    </div>`;
}

function bloomStyles(config: TemplateConfig): string {
  const { typography } = config;
  return `
    .layout-bloom {
      margin: -10mm;
      padding: 8mm;
      background: #F4F6F8;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-bloom .bloom-stack { display: flex; flex-direction: column; gap: 12px; }
    .layout-bloom .bloom-card,
    .layout-bloom .bloom-bar {
      background: #fff;
      border-radius: 16px;
      padding: 16px 18px;
    }
    .layout-bloom .bloom-bar {
      background: #EEF1F4;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      padding: 14px 18px;
    }
    .layout-bloom .bloom-pair {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .layout-bloom .bloom-kicker {
      color: #6B7280;
      font-weight: 500;
    }
    .layout-bloom .bloom-kicker .document-title,
    .layout-bloom .bloom-kicker .document-title p {
      display: inline;
      margin: 0;
      font-size: inherit;
      font-weight: inherit;
      color: inherit;
    }
    .layout-bloom .bloom-strong { font-weight: 700; color: #111827; }
    .layout-bloom .bloom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .layout-bloom .bloom-card-label {
      font-size: ${typography.labelFontSize}px;
      font-weight: 700;
      color: #6B7280;
      margin: 0 0 10px;
    }
    .layout-bloom .bloom-name { font-weight: 700; margin: 0 0 4px; }
    .layout-bloom .bloom-muted { color: #6B7280; line-height: 1.5; }
    .layout-bloom .bloom-muted p { margin: 0; }
    .layout-bloom .bloom-table-card { padding: 16px 18px 14px; }
    .layout-bloom table { margin: 0; }
    .layout-bloom th {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 700;
      color: #6B7280;
      border-bottom: 1px solid #E5E7EB;
      background: transparent;
      padding: 6px 10px 12px;
    }
    .layout-bloom td {
      padding: 12px 10px;
      border-bottom: 1px solid #F3F4F6;
      color: #111827;
    }
    .layout-bloom td[data-col="description"] { font-weight: 700; }
    .layout-bloom th:first-child, .layout-bloom td:first-child { padding-left: 2px; text-align: left; }
    .layout-bloom th.num, .layout-bloom td.num { text-align: right; font-weight: 400; }
    .layout-bloom th.qty, .layout-bloom td.qty { text-align: center; }
    .layout-bloom tbody tr:last-child td { border-bottom: 1px solid #E5E7EB; }
    .layout-bloom .totals {
      width: auto;
      min-width: 220px;
      margin: 10px 0 0 auto;
    }
    .layout-bloom .totals div { padding: 6px 0; color: #4B5563; }
    .layout-bloom .totals .grand {
      color: #111827;
      font-size: ${Math.round(typography.baseFontSize * 1.25)}px;
      font-weight: 800;
      border-top: 1px solid #E5E7EB;
      margin-top: 4px;
      padding-top: 10px;
    }
    .layout-bloom .bloom-thanks-title { font-weight: 700; margin: 0 0 6px; }
    .layout-bloom .bloom-thanks-title p { margin: 0; }
    .layout-bloom .bloom-invoice-echo { color: #6B7280; font-size: ${typography.labelFontSize}px; }
    .layout-bloom .bloom-pay { color: #4B5563; line-height: 1.55; }
    .layout-bloom .bloom-pay p { margin: 0 0 6px; }
    .layout-bloom .bloom-contact {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 8px 4px 0;
      color: #6B7280;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-bloom .bloom-contact-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .layout-bloom .bloom-contact .logo-wrap { margin: 0; }
    .layout-bloom .bloom-contact .logo {
      width: 28px;
      height: 28px;
      max-width: 28px;
      max-height: 28px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0;
    }
    .layout-bloom .bloom-contact .social-links { justify-content: flex-end; margin: 0; }
    .layout-bloom .bloom-contact .social-link { color: #6B7280; }
    .layout-bloom .custom-note { background: #fff; border-radius: 16px; }
    [dir="rtl"] .layout-bloom th.num, [dir="rtl"] .layout-bloom td.num { text-align: left; }
  `;
}

function buildBloomParty(
  kicker: string,
  name: string,
  lines: string[]
): string {
  if (!name && lines.length === 0) return '';
  return `<div class="bloom-card">
    <div class="bloom-card-label">${kicker}</div>
    ${name ? `<div class="bloom-name">${name}</div>` : ''}
    ${lines.length ? `<div class="bloom-muted">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildBloomBuyerCard(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '<div></div>';
  const f = config.sections.buyer.fields;
  const name = f.name && hasText(data.buyer.name) ? esc(data.buyer.name) : '';
  const lines: string[] = [];
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  return buildBloomParty(label(config, 'buyer', 'To'), name, lines) || '<div></div>';
}

function buildBloomSellerCard(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '<div></div>';
  const f = config.sections.seller.fields;
  const name = f.legalName && hasText(data.seller.legalName) ? esc(data.seller.legalName) : '';
  const lines: string[] = [];
  if (f.address && hasText(data.seller.address.city)) {
    lines.push(`<p>${esc(data.seller.address.city)}</p>`);
  } else if (f.address && hasText(data.seller.address.line1)) {
    lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  return buildBloomParty(label(config, 'seller', 'From'), name, lines) || '<div></div>';
}

function buildBloomHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Service</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.quantity) headers.push('<th class="num qty">Qty</th>');
  if (cols.unitPrice) headers.push('<th class="num">Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Line total</th>');
  return headers.join('');
}

function buildBloomRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="num qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function renderBloomLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const numberLabel = title || label(config, 'invoiceNumber', 'Invoice');
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildBloomHeaders(config)}</tr></thead><tbody>${buildBloomRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const thanksCard = richTextHasContent(thanks)
    ? `<div class="bloom-card">
        <div class="bloom-thanks-title">${thanks}</div>
        ${hasText(data.invoiceNumber) ? `<div class="bloom-invoice-echo">${esc(data.invoiceNumber)}</div>` : ''}
      </div>`
    : '';
  const payCard =
    config.content.showTerms !== false && richTextHasContent(terms)
      ? `<div class="bloom-card">
          <div class="bloom-card-label">Terms / payment info</div>
          <div class="bloom-pay">${terms}</div>
        </div>`
      : '';
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const brandName =
    config.sections.seller.visible !== false &&
    config.sections.seller.fields.legalName &&
    hasText(data.seller.legalName)
      ? `<span>${esc(data.seller.legalName)}</span>`
      : '';

  return `
    <div class="layout-bloom">
      <div class="bloom-stack">
        <div class="bloom-bar">
          <div class="bloom-pair"><span class="bloom-kicker">${numberLabel}</span><span class="bloom-strong">${esc(data.invoiceNumber)}</span></div>
          ${
            hasText(data.issueDate)
              ? `<div class="bloom-pair"><span class="bloom-kicker">${label(config, 'issueDate', 'Date')}</span><span class="bloom-strong">${esc(data.issueDate)}</span></div>`
              : ''
          }
        </div>
        <div class="bloom-grid">
          ${buildBloomBuyerCard(config, data)}
          ${buildBloomSellerCard(config, data)}
        </div>
        <div class="bloom-card bloom-table-card">
          ${tableSection}
          ${showPrices ? buildTotals(config, data) : ''}
        </div>
        ${buildOrderNote(config, data)}
        ${
          config.content.showNotes !== false && richTextHasContent(config.content.customNote.html)
            ? `<div class="bloom-card"><div class="bloom-card-label">Notes</div>${rich(config.content.customNote.html)}</div>`
            : ''
        }
        ${buildVerificationBlock(config, data)}
        ${thanksCard || payCard ? `<div class="bloom-grid">${thanksCard}${payCard}</div>` : ''}
        <div class="bloom-contact">
          <div class="bloom-contact-brand">${buildLogo(config)}${brandName}</div>
          ${social}
        </div>
      </div>
    </div>`;
}

function irisStyles(config: TemplateConfig): string {
  const { typography } = config;
  return `
    .layout-iris { color: #111827; }
    .layout-iris .iris-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 18px;
    }
    .layout-iris .iris-title,
    .layout-iris .iris-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.05;
      color: #111827;
      margin: 0 0 6px;
    }
    .layout-iris .iris-title p { margin: 0; }
    .layout-iris .iris-number { color: #6B7280; }
    .layout-iris .iris-header .logo-wrap { text-align: right; margin: 0; }
    .layout-iris .iris-header .logo {
      max-height: 52px;
      max-width: 72px;
      margin: 0;
    }
    .layout-iris .iris-parties {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      border-top: 1px solid #E5E7EB;
      border-bottom: 1px solid #E5E7EB;
      margin-bottom: 28px;
    }
    .layout-iris .iris-col { padding: 18px 20px 18px 0; min-width: 0; }
    .layout-iris .iris-col + .iris-col {
      border-left: 1px solid #E5E7EB;
      padding-left: 20px;
    }
    .layout-iris .iris-kicker {
      font-weight: 700;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-iris .iris-name { font-weight: 700; margin: 0 0 4px; }
    .layout-iris .iris-muted { color: #4B5563; line-height: 1.5; }
    .layout-iris .iris-muted p { margin: 0; }
    .layout-iris table { margin: 0; }
    .layout-iris th {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 700;
      color: #111827;
      border-bottom: 1px solid #E5E7EB;
      background: transparent;
      padding: 6px 10px 12px;
    }
    .layout-iris td {
      padding: 12px 10px;
      border-bottom: 0;
      color: #111827;
    }
    .layout-iris td[data-col="description"] { font-weight: 700; }
    .layout-iris th:first-child, .layout-iris td:first-child { padding-left: 0; text-align: left; }
    .layout-iris th.num, .layout-iris td.num { text-align: right; font-weight: 400; }
    .layout-iris th.qty, .layout-iris td.qty { text-align: right; }
    .layout-iris tbody tr:last-child td { border-bottom: 1px solid #E5E7EB; padding-bottom: 16px; }
    .layout-iris .iris-summary {
      width: 280px;
      max-width: 42%;
      margin: 16px 0 0 auto;
    }
    .layout-iris .iris-summary .totals {
      width: 100%;
      margin: 0;
    }
    .layout-iris .totals div { padding: 6px 0; color: #4B5563; }
    .layout-iris .totals .grand { display: none; }
    .layout-iris .iris-total-line {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0 8px;
      font-weight: 700;
      color: #111827;
      border-top: 1px solid #E5E7EB;
    }
    .layout-iris .iris-due {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      font-weight: 700;
      color: var(--primary);
      border-top: 1px solid var(--primary);
      border-bottom: 1px solid #E5E7EB;
    }
    .layout-iris .iris-terms { margin-top: 28px; }
    .layout-iris .iris-terms-label {
      font-weight: 700;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-iris .iris-terms-body { color: #4B5563; line-height: 1.55; }
    .layout-iris .iris-thanks { margin-top: 32px; }
    .layout-iris .iris-thanks-title { font-weight: 700; margin: 0 0 6px; }
    .layout-iris .iris-thanks-title p { margin: 0; }
    .layout-iris .iris-echo {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #6B7280;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-iris .iris-echo-icon { flex-shrink: 0; }
    .layout-iris .iris-foot {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid #E5E7EB;
      color: #6B7280;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-iris .iris-foot > :nth-child(2) { text-align: center; }
    .layout-iris .iris-foot > :nth-child(3) { text-align: right; }
    .layout-iris .iris-foot .social-links { justify-content: flex-end; margin: 0; }
    .layout-iris .iris-foot .social-link { color: #6B7280; }
    [dir="rtl"] .layout-iris th.num, [dir="rtl"] .layout-iris td.num { text-align: left; }
    [dir="rtl"] .layout-iris .iris-col + .iris-col { border-left: 0; border-right: 1px solid #E5E7EB; }
  `;
}

const IRIS_DOC_ICON = `<svg class="iris-echo-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.25 1.5h5.19L13.5 5.56V13.5A1.25 1.25 0 0 1 12.25 14.75h-8A1.25 1.25 0 0 1 3 13.5v-11A1.25 1.25 0 0 1 4.25 1.5Zm4.75 1.2V6h3.05L9 2.7Z"/></svg>`;

function irisWebsiteHost(config: TemplateConfig): string {
  const site = (config.socialLinks?.links ?? []).find((link) => link.platform === 'website' && link.url);
  if (!site?.url) return '';
  try {
    return new URL(site.url).host.replace(/^www\./i, '');
  } catch {
    return site.label?.trim() || '';
  }
}

function buildIrisIssued(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!hasText(data.issueDate)) return '<div class="iris-col"></div>';
  return `<div class="iris-col">
    <div class="iris-kicker">${label(config, 'issueDate', 'Issued')}</div>
    <div>${esc(data.issueDate)}</div>
  </div>`;
}

function buildIrisBuyerCol(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '<div class="iris-col"></div>';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  if (f.name && hasText(data.buyer.name)) lines.push(`<div class="iris-name">${esc(data.buyer.name)}</div>`);
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '<div class="iris-col"></div>';
  const name = lines.shift() ?? '';
  return `<div class="iris-col">
    <div class="iris-kicker">${label(config, 'buyer', 'Billed to')}</div>
    ${name}
    ${lines.length ? `<div class="iris-muted">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildIrisFromCol(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '<div class="iris-col"></div>';
  const f = config.sections.seller.fields;
  const lines: string[] = [];
  if (f.legalName && hasText(data.seller.legalName)) {
    lines.push(`<div class="iris-name">${esc(data.seller.legalName)}</div>`);
  }
  const loc: string[] = [];
  if (f.address && hasText(data.seller.address.city)) loc.push(esc(data.seller.address.city));
  else if (f.address && hasText(data.seller.address.line1)) loc.push(esc(data.seller.address.line1));
  if (f.emirate && hasText(data.seller.address.country)) loc.push(data.seller.address.country);
  if (loc.length) lines.push(`<p>${loc.join(', ')}</p>`);
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  if (lines.length === 0) return '<div class="iris-col"></div>';
  const name = lines.shift() ?? '';
  return `<div class="iris-col">
    <div class="iris-kicker">${label(config, 'seller', 'From')}</div>
    ${name}
    ${lines.length ? `<div class="iris-muted">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildIrisHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Service</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.quantity) headers.push('<th class="num qty">Qty</th>');
  if (cols.unitPrice) headers.push('<th class="num">Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Line total</th>');
  return headers.join('');
}

function buildIrisRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="num qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function renderIrisLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildIrisHeaders(config)}</tr></thead><tbody>${buildIrisRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const dueLabel = label(config, 'grandTotal', 'Amount due');
  const website = irisWebsiteHost(config);
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: (config.socialLinks?.links ?? []).filter((link) => link.platform !== 'website'),
  });
  const showFoot = Boolean(website || social);

  return `
    <div class="layout-iris">
      <div class="iris-header">
        <div>
          ${title ? `<div class="iris-title">${title}</div>` : ''}
          ${hasText(data.invoiceNumber) ? `<div class="iris-number">${esc(data.invoiceNumber)}</div>` : ''}
        </div>
        ${buildLogo(config)}
      </div>
      <div class="iris-parties">
        ${buildIrisIssued(config, data)}
        ${buildIrisBuyerCol(config, data)}
        ${buildIrisFromCol(config, data)}
      </div>
      ${tableSection}
      ${
        showPrices
          ? `<div class="iris-summary">${buildTotals(config, data)}
              <div class="iris-total-line"><span>Total</span><span>${esc(data.totals.grandTotal)} ${esc(data.currency)}</span></div>
              <div class="iris-due"><span>${dueLabel}</span><span>${esc(data.currency)} ${esc(data.totals.grandTotal)}</span></div>
            </div>`
          : ''
      }
      ${buildOrderNote(config, data)}
      ${
        config.content.showNotes !== false && richTextHasContent(config.content.customNote.html)
          ? `<div class="iris-terms"><div class="iris-terms-label">Notes</div><div class="iris-terms-body">${rich(config.content.customNote.html)}</div></div>`
          : ''
      }
      ${
        config.content.showTerms !== false && richTextHasContent(terms)
          ? `<div class="iris-terms"><div class="iris-terms-label">Terms / payment info</div><div class="iris-terms-body">${terms}</div></div>`
          : ''
      }
      ${buildVerificationBlock(config, data)}
      ${
        richTextHasContent(thanks)
          ? `<div class="iris-thanks">
              <div class="iris-thanks-title">${thanks}</div>
              ${
                hasText(data.invoiceNumber)
                  ? `<div class="iris-echo">${IRIS_DOC_ICON}<span>Invoice ${esc(data.invoiceNumber)}</span></div>`
                  : ''
              }
            </div>`
          : ''
      }
      ${
        showFoot
          ? `<div class="iris-foot"><div>${website ? esc(website) : ''}</div><div></div><div>${social}</div></div>`
          : ''
      }
    </div>`;
}

function hazeStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  return `
    .layout-haze {
      margin: -10mm;
      padding: 8mm;
      background: #F3F4F6;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-haze .haze-sheet {
      background: #fff;
      padding: 12mm 11mm 10mm;
      min-height: 245mm;
    }
    .layout-haze .haze-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-haze .haze-brand {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 0;
    }
    .layout-haze .haze-brand .logo-wrap { margin: 0; }
    .layout-haze .haze-brand .logo {
      max-height: 40px;
      max-width: 40px;
      margin: 0;
    }
    .layout-haze .haze-brand-name { font-weight: 700; margin: 0 0 4px; line-height: 1.3; }
    .layout-haze .haze-brand-meta {
      color: #6B7280;
      line-height: 1.45;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-haze .haze-brand-meta p { margin: 0; }
    .layout-haze .haze-title-block { text-align: right; }
    .layout-haze .haze-title,
    .layout-haze .haze-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 700;
      color: #D1D5DB;
      margin: 0;
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .layout-haze .haze-title p { margin: 0; }
    .layout-haze .haze-number { color: #6B7280; margin-top: 4px; }
    .layout-haze .haze-meta {
      display: grid;
      grid-template-columns: 1.2fr 1fr auto;
      gap: 28px;
      align-items: start;
      margin-bottom: 28px;
    }
    .layout-haze .haze-kicker {
      font-size: ${typography.labelFontSize}px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9CA3AF;
      margin: 0 0 8px;
    }
    .layout-haze .haze-name { font-weight: 700; margin: 0 0 4px; }
    .layout-haze .haze-muted { color: #4B5563; line-height: 1.5; }
    .layout-haze .haze-muted p { margin: 0; }
    .layout-haze .haze-due { text-align: right; }
    .layout-haze .haze-chip {
      display: inline-block;
      background: ${branding.accentColor};
      color: ${branding.primaryColor};
      font-weight: 800;
      padding: 8px 14px;
      min-width: 132px;
      text-align: center;
    }
    .layout-haze .haze-order { font-weight: 700; margin: 0 0 10px; }
    .layout-haze table { margin: 0; }
    .layout-haze th {
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      color: #9CA3AF;
      border-bottom: 1px solid #E5E7EB;
      background: transparent;
      padding: 10px 8px 10px 0;
    }
    .layout-haze td {
      padding: 12px 8px 12px 0;
      border-bottom: 0;
      vertical-align: top;
    }
    .layout-haze td[data-col="description"] { font-weight: 700; }
    .layout-haze th.num, .layout-haze td.num { text-align: right; padding-right: 0; font-weight: 400; }
    .layout-haze th.idx, .layout-haze td.idx { width: 28px; color: #6B7280; font-weight: 400; }
    .layout-haze tbody tr:last-child td { padding-bottom: 16px; }
    .layout-haze .haze-vat {
      width: 280px;
      max-width: 42%;
      margin: 8px 0 0 auto;
    }
    .layout-haze .haze-vat .totals { width: 100%; margin: 0; }
    .layout-haze .haze-vat .totals div { padding: 4px 0; color: #6B7280; }
    .layout-haze .haze-vat .totals .grand { display: none; }
    .layout-haze .haze-total-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      margin-top: 8px;
      padding: 12px 0;
      border-top: 1px solid #E5E7EB;
      font-weight: 700;
    }
    .layout-haze .haze-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 28px 0 36px;
      color: #D1D5DB;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-haze .haze-thanks { margin: 0 0 16px; color: #6B7280; }
    .layout-haze .haze-thanks p { margin: 0; }
    .layout-haze .haze-pay {
      border-top: 1px solid #E5E7EB;
      padding-top: 16px;
    }
    .layout-haze .haze-pay-label {
      font-size: ${typography.labelFontSize}px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9CA3AF;
      margin: 0 0 12px;
    }
    .layout-haze .haze-pay-terms { margin-top: 0; color: #4B5563; line-height: 1.55; }
    [dir="rtl"] .layout-haze .haze-title-block, [dir="rtl"] .layout-haze .haze-due { text-align: left; }
    [dir="rtl"] .layout-haze th.num, [dir="rtl"] .layout-haze td.num { text-align: left; }
  `;
}

const HAZE_DOC_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.25 1.5h5.19L13.5 5.56V13.5A1.25 1.25 0 0 1 12.25 14.75h-8A1.25 1.25 0 0 1 3 13.5v-11A1.25 1.25 0 0 1 4.25 1.5Zm4.75 1.2V6h3.05L9 2.7Z"/></svg>`;

function buildHazeBuyer(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  if (f.name && hasText(data.buyer.name)) lines.push(`<div class="haze-name">${esc(data.buyer.name)}</div>`);
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '';
  const name = lines.shift() ?? '';
  return `<div>
    <div class="haze-kicker">${label(config, 'buyer', 'Billed to')}</div>
    ${name}
    ${lines.length ? `<div class="haze-muted">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildHazeHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = ['<th class="idx">#</th>'];
  if (cols.description) headers.push('<th>Title / description</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.quantity) headers.push('<th class="num">Qty</th>');
  if (cols.unitPrice) headers.push('<th class="num">Rate</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Subtotal</th>');
  return headers.join('');
}

function buildHazeRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item, index) => {
      const cells: string[] = [`<td class="idx">${index + 1}</td>`];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="num">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildHazeSellerIdentity(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return buildLogo(config);
  const f = config.sections.seller.fields;
  const name =
    f.legalName && hasText(data.seller.legalName)
      ? `<div class="haze-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const lines: string[] = [];
  if (f.address && hasText(data.seller.address.line1)) {
    lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  } else if (f.address && hasText(data.seller.address.city)) {
    lines.push(`<p>${esc(data.seller.address.city)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  const meta = lines.length ? `<div class="haze-brand-meta">${lines.join('')}</div>` : '';
  return `<div class="haze-brand">${buildLogo(config)}<div>${name}${meta}</div></div>`;
}

function renderHazeLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildHazeHeaders(config)}</tr></thead><tbody>${buildHazeRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const dueLabel = label(config, 'grandTotal', 'Amount due');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const social = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  return `
    <div class="layout-haze">
      <div class="haze-sheet">
        <div class="haze-header">
          ${buildHazeSellerIdentity(config, data)}
          <div class="haze-title-block">
            ${title ? `<div class="haze-title">${title}</div>` : ''}
            ${hasText(data.invoiceNumber) ? `<div class="haze-number">${esc(data.invoiceNumber)}</div>` : ''}
          </div>
        </div>
        <div class="haze-meta">
          ${buildHazeBuyer(config, data)}
          ${
            hasText(data.issueDate)
              ? `<div><div class="haze-kicker">${label(config, 'issueDate', 'Invoice date')}</div><div>${esc(data.issueDate)}</div></div>`
              : '<div></div>'
          }
          ${
            showPrices
              ? `<div class="haze-due"><div class="haze-kicker">${dueLabel}</div><div class="haze-chip">${esc(data.currency)} ${esc(data.totals.grandTotal)}</div></div>`
              : '<div></div>'
          }
        </div>
        ${hasText(data.orderNumber) ? `<div class="haze-order">Order ${esc(data.orderNumber)}</div>` : ''}
        ${tableSection}
        ${showPrices ? `<div class="haze-vat">${buildTotals(config, data)}</div>` : ''}
        ${
          showPrices
            ? `<div class="haze-total-row"><span>Total</span><span>${esc(data.currency)} ${esc(data.totals.grandTotal)}</span></div>`
            : ''
        }
        ${
          hasText(data.invoiceNumber)
            ? `<div class="haze-mark">${HAZE_DOC_ICON}<span>Invoice ${esc(data.invoiceNumber)}</span></div>`
            : ''
        }
        ${buildOrderNote(config, data)}
        ${
          config.content.showNotes !== false && richTextHasContent(config.content.customNote.html)
            ? `<div class="haze-pay-terms" style="margin-bottom:16px">${rich(config.content.customNote.html)}</div>`
            : ''
        }
        ${richTextHasContent(thanks) ? `<div class="haze-thanks">${thanks}</div>` : ''}
        ${
          showPay
            ? `<div class="haze-pay">
                <div class="haze-pay-label">Terms / payment info</div>
                <div class="haze-pay-terms">${terms}</div>
              </div>`
            : ''
        }
        ${buildVerificationBlock(config, data)}
        ${social}
      </div>
    </div>`;
}

function ledgerStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const ink = branding.primaryColor || '#111111';
  return `
    .layout-ledger {
      color: ${ink};
      min-height: 100%;
    }
    .layout-ledger .ledger-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-ledger .ledger-brand { min-width: 0; max-width: 58%; }
    .layout-ledger .ledger-brand .logo-wrap { margin: 0 0 10px; }
    .layout-ledger .ledger-brand .logo {
      max-height: 48px;
      max-width: 160px;
      margin: 0;
    }
    .layout-ledger .ledger-brand-name { font-weight: 700; margin: 0 0 4px; line-height: 1.3; }
    .layout-ledger .ledger-brand-meta { color: #4B5563; line-height: 1.45; }
    .layout-ledger .ledger-brand-meta p { margin: 0; }
    .layout-ledger .ledger-title-block { text-align: right; }
    .layout-ledger .ledger-title,
    .layout-ledger .ledger-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0;
      line-height: 1.05;
      color: ${ink};
    }
    .layout-ledger .ledger-title p { margin: 0; }
    .layout-ledger .ledger-ids {
      margin-top: 8px;
      color: #374151;
      letter-spacing: 0.02em;
    }
    .layout-ledger .ledger-bill { margin: 0 0 32px; }
    .layout-ledger .ledger-bill-label { margin: 0 0 6px; }
    .layout-ledger .ledger-bill-name { font-weight: 700; margin: 0 0 4px; }
    .layout-ledger .ledger-bill-meta { color: #4B5563; line-height: 1.5; }
    .layout-ledger .ledger-bill-meta p { margin: 0; }
    .layout-ledger table {
      width: 100%;
      margin: 0;
      border-collapse: collapse;
      border: 2px solid ${ink};
    }
    .layout-ledger th,
    .layout-ledger td {
      border: 1px solid ${ink};
      vertical-align: top;
    }
    .layout-ledger th {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: ${ink};
      background: transparent;
      padding: 10px 12px;
    }
    .layout-ledger td {
      padding: 12px;
    }
    .layout-ledger th.num, .layout-ledger td.num { text-align: right; padding-right: 12px; }
    .layout-ledger th.qty, .layout-ledger td.qty { text-align: center; width: 72px; }
    .layout-ledger th:last-child, .layout-ledger td:last-child { padding-right: 0; }
    .layout-ledger .ledger-foot {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
      margin-top: 28px;
    }
    .layout-ledger .ledger-terms { flex: 1; min-width: 0; max-width: 52%; }
    .layout-ledger .ledger-terms-label {
      font-size: ${typography.labelFontSize}px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 8px;
    }
    .layout-ledger .ledger-terms-body { color: #4B5563; line-height: 1.55; }
    .layout-ledger .ledger-terms-body p { margin: 0; }
    .layout-ledger .ledger-summary {
      width: 260px;
      max-width: 42%;
      margin-left: auto;
      flex-shrink: 0;
    }
    .layout-ledger .ledger-summary .totals { width: 100%; margin: 0; }
    .layout-ledger .ledger-summary .totals div {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-ledger .ledger-summary .totals .grand {
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid ${ink};
      font-weight: 800;
      font-size: ${typography.baseFontSize}px;
      color: ${ink};
    }
    [dir="rtl"] .layout-ledger .ledger-title-block { text-align: left; }
    [dir="rtl"] .layout-ledger .ledger-summary { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-ledger th.num, [dir="rtl"] .layout-ledger td.num { text-align: left; }
  `;
}

function buildLedgerSellerIdentity(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return buildLogo(config);
  const f = config.sections.seller.fields;
  const name =
    f.legalName && hasText(data.seller.legalName)
      ? `<div class="ledger-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const lines: string[] = [];
  if (f.address && hasText(data.seller.address.line1)) {
    lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  } else if (f.address && hasText(data.seller.address.city)) {
    lines.push(`<p>${esc(data.seller.address.city)}</p>`);
  }
  if (f.emirate && hasText(data.seller.address.emirate)) {
    lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }
  if (f.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
    lines.push(
      `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
    );
  }
  const meta = lines.length ? `<div class="ledger-brand-meta">${lines.join('')}</div>` : '';
  return `<div class="ledger-brand">${buildLogo(config)}${name}${meta}</div>`;
}

function buildLedgerBuyer(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  if (f.name && hasText(data.buyer.name)) {
    lines.push(`<div class="ledger-bill-name">${esc(data.buyer.name)}</div>`);
  }
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '';
  const name = lines.shift() ?? '';
  return `<div class="ledger-bill">
    <div class="ledger-bill-label">${label(config, 'buyer', 'Bill To')}:</div>
    ${name}
    ${lines.length ? `<div class="ledger-bill-meta">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildLedgerHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Item description</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.unitPrice) headers.push('<th class="num">Price</th>');
  if (cols.quantity) headers.push('<th class="qty">Qty</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Total</th>');
  return headers.join('');
}

function buildLedgerRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildLedgerTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<div><span>${label(config, 'subtotal', 'Sub Total')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div><span>${label(config, 'vatTotal', 'Tax')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount) {
    rows.push(
      `<div><span>${label(config, 'discount', 'Discount')}</span><span>${data.totals.discount} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<div class="grand"><span>${label(config, 'grandTotal', 'Grand Total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
    );
  }
  return `<div class="ledger-summary"><div class="totals">${rows.join('')}</div></div>`;
}

function renderLedgerLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildLedgerHeaders(config)}</tr></thead><tbody>${buildLedgerRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const ledgerSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const ids = [data.invoiceNumber, data.issueDate]
    .filter((part) => hasText(part))
    .map((part) => esc(part))
    .join('&nbsp;&nbsp;&nbsp;');

  return `
    <div class="layout-ledger">
      <div class="ledger-header">
        ${buildLedgerSellerIdentity(config, data)}
        <div class="ledger-title-block">
          ${title ? `<div class="ledger-title">${title}</div>` : ''}
          ${ids ? `<div class="ledger-ids">${ids}</div>` : ''}
        </div>
      </div>
      ${buildLedgerBuyer(config, data)}
      ${tableSection}
      ${buildOrderNote(config, data)}
      ${
        config.content.showNotes !== false && richTextHasContent(config.content.customNote.html)
          ? `<div class="ledger-terms-body" style="margin:16px 0">${rich(config.content.customNote.html)}</div>`
          : ''
      }
      <div class="ledger-foot">
        <div class="ledger-terms">
          ${
            showPay
              ? `<div class="ledger-terms-label">Terms / payment info</div>
                 <div class="ledger-terms-body">${terms}</div>`
              : ''
          }
          ${richTextHasContent(thanks) ? `<div class="ledger-terms-body" style="margin-top:12px">${thanks}</div>` : ''}
        </div>
        ${showPrices ? buildLedgerTotals(config, data) : ''}
      </div>
      ${buildVerificationBlock(config, data)}
      ${ledgerSocial}
    </div>`;
}

function noirStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const ink = branding.primaryColor || '#111111';
  return `
    .layout-noir {
      margin: -10mm;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-noir .noir-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      background: ${ink};
      color: #fff;
      padding: 14px 10mm;
    }
    .layout-noir .noir-brand { min-width: 0; }
    .layout-noir .noir-brand .logo-wrap { margin: 0 0 8px; }
    .layout-noir .noir-brand .logo {
      max-height: 44px;
      max-width: 120px;
      margin: 0;
      background: #fff;
      padding: 4px;
    }
    .layout-noir .noir-brand-name { font-weight: 700; margin: 0; line-height: 1.3; }
    .layout-noir .noir-seller {
      text-align: right;
      line-height: 1.45;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-noir .noir-seller p { margin: 0; }
    .layout-noir .noir-body { padding: 10mm; }
    .layout-noir .noir-meta {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-noir .noir-bill { min-width: 0; max-width: 58%; }
    .layout-noir .noir-bill-label { margin: 0 0 6px; }
    .layout-noir .noir-bill-name { font-weight: 700; margin: 0 0 4px; }
    .layout-noir .noir-bill-lines { color: #4B5563; line-height: 1.5; }
    .layout-noir .noir-bill-lines p { margin: 0; }
    .layout-noir .noir-title-block { text-align: right; }
    .layout-noir .noir-title,
    .layout-noir .noir-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0;
      line-height: 1.05;
      color: #111827;
    }
    .layout-noir .noir-title p { margin: 0; }
    .layout-noir .noir-ids { margin-top: 8px; color: #374151; }
    .layout-noir table {
      margin: 0;
      border-collapse: collapse;
      border-top: 1px solid #D1D5DB;
    }
    .layout-noir th {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: #111827;
      background: transparent;
      border-bottom: 1px solid #D1D5DB;
      padding: 10px 12px 10px 0;
    }
    .layout-noir td {
      padding: 12px 12px 12px 0;
      border-bottom: 1px solid #E5E7EB;
      vertical-align: top;
    }
    .layout-noir th.num, .layout-noir td.num { text-align: right; padding-right: 0; }
    .layout-noir th.qty, .layout-noir td.qty { text-align: center; width: 72px; }
    .layout-noir .noir-summary-band {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
      padding: 16px 0 8px;
      border-bottom: 1px solid #D1D5DB;
    }
    .layout-noir .noir-terms { flex: 1; min-width: 0; max-width: 52%; }
    .layout-noir .noir-terms-label { font-weight: 700; margin: 0 0 8px; }
    .layout-noir .noir-terms-body { color: #4B5563; line-height: 1.55; }
    .layout-noir .noir-terms-body p { margin: 0; }
    .layout-noir .noir-totals {
      width: 260px;
      max-width: 42%;
      margin-left: auto;
      flex-shrink: 0;
    }
    .layout-noir .noir-totals .totals { width: 100%; margin: 0; }
    .layout-noir .noir-totals .totals div {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-noir .noir-totals .totals .grand {
      font-weight: 800;
      font-size: ${typography.baseFontSize}px;
      color: ${ink};
      border-top: 0;
      margin-top: 2px;
      padding-top: 8px;
    }
    .layout-noir .noir-notes { margin-top: 22px; }
    .layout-noir .noir-notes-label { font-weight: 700; margin: 0 0 6px; }
    .layout-noir .noir-notes-body { color: #4B5563; line-height: 1.55; }
    .layout-noir .noir-notes-body p { margin: 0; }
    .layout-noir .noir-thanks {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid #D1D5DB;
      text-align: center;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .layout-noir .noir-thanks p { margin: 0; }
    [dir="rtl"] .layout-noir .noir-seller, [dir="rtl"] .layout-noir .noir-title-block { text-align: left; }
    [dir="rtl"] .layout-noir .noir-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-noir th.num, [dir="rtl"] .layout-noir td.num { text-align: left; }
  `;
}

function buildNoirSellerBar(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const f = config.sections.seller.fields;
  const showSeller = config.sections.seller.visible !== false;
  const name =
    showSeller && f.legalName && hasText(data.seller.legalName)
      ? `<div class="noir-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const lines: string[] = [];
  if (showSeller) {
    if (f.address && hasText(data.seller.address.line1)) {
      lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    } else if (f.address && hasText(data.seller.address.city)) {
      lines.push(`<p>${esc(data.seller.address.city)}</p>`);
    }
    if (f.emirate && hasText(data.seller.address.emirate)) {
      lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    }
    if (f.trn && hasText(data.seller.trn)) {
      lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    }
    if (f.tradeLicence && hasText(data.seller.tradeLicence)) {
      lines.push(
        `<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`
      );
    }
  }
  const meta = lines.length ? `<div class="noir-seller">${lines.join('')}</div>` : '';
  return `<div class="noir-bar"><div class="noir-brand">${buildLogo(config)}${name}</div>${meta}</div>`;
}

function buildNoirBuyer(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const f = config.sections.buyer.fields;
  const lines: string[] = [];
  if (f.name && hasText(data.buyer.name)) {
    lines.push(`<div class="noir-bill-name">${esc(data.buyer.name)}</div>`);
  }
  if (f.address && hasText(data.buyer.addressLine)) {
    lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }
  if (f.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (f.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '';
  const name = lines.shift() ?? '';
  return `<div class="noir-bill">
    <div class="noir-bill-label">${label(config, 'buyer', 'Invoice To')}:</div>
    ${name}
    ${lines.length ? `<div class="noir-bill-lines">${lines.join('')}</div>` : ''}
  </div>`;
}

function buildNoirHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Item description</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.unitPrice) headers.push('<th class="num">Price</th>');
  if (cols.quantity) headers.push('<th class="qty">Qty</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Total</th>');
  return headers.join('');
}

function buildNoirRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildNoirTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<div><span>${label(config, 'subtotal', 'Sub Total')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div><span>${label(config, 'vatTotal', 'Tax')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<div><span>${label(config, 'discount', 'Discount')}</span><span>${data.totals.discount} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<div class="grand"><span>${label(config, 'grandTotal', 'Grand Total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
    );
  }
  return `<div class="noir-totals"><div class="totals">${rows.join('')}</div></div>`;
}

function renderNoirLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildNoirHeaders(config)}</tr></thead><tbody>${buildNoirRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const noirSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const ids = [data.invoiceNumber, data.issueDate]
    .filter((part) => hasText(part))
    .map((part) => esc(part))
    .join('<br />');

  return `
    <div class="layout-noir">
      ${buildNoirSellerBar(config, data)}
      <div class="noir-body">
        <div class="noir-meta">
          ${buildNoirBuyer(config, data)}
          <div class="noir-title-block">
            ${title ? `<div class="noir-title">${title}</div>` : ''}
            ${ids ? `<div class="noir-ids">${ids}</div>` : ''}
          </div>
        </div>
        ${tableSection}
        ${buildOrderNote(config, data)}
        <div class="noir-summary-band">
          <div class="noir-terms">
            ${
              showPay
                ? `<div class="noir-terms-label">Terms / payment info</div>
                   <div class="noir-terms-body">${terms}</div>`
                : ''
            }
          </div>
          ${showPrices ? buildNoirTotals(config, data) : ''}
        </div>
        ${
          showNotes
            ? `<div class="noir-notes">
                <div class="noir-notes-label">Notes</div>
                <div class="noir-notes-body">${rich(config.content.customNote.html)}</div>
              </div>`
            : ''
        }
        ${richTextHasContent(thanks) ? `<div class="noir-thanks">${thanks}</div>` : ''}
        ${buildVerificationBlock(config, data)}
        ${noirSocial}
      </div>
    </div>`;
}

function slateStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const ink = branding.primaryColor || '#111111';
  return `
    .layout-slate {
      margin: -10mm;
      padding: 10mm;
      background: #F5F5F0;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-slate .slate-sheet {
      background: #fff;
      padding: 12mm 11mm 10mm;
      min-height: 245mm;
    }
    .layout-slate .slate-center-header {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid #D1D5DB;
    }
    .layout-slate .slate-center-header .logo-wrap { margin: 0 auto 10px; text-align: center; }
    .layout-slate .slate-center-header .logo {
      max-height: 44px;
      max-width: 160px;
      margin: 0 auto;
    }
    .layout-slate .slate-title,
    .layout-slate .slate-title .document-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin: 0;
      color: ${ink};
    }
    .layout-slate .slate-title p { margin: 0; }
    .layout-slate .slate-seller-name {
      font-size: ${typography.baseFontSize}px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 8px 0 0;
      color: #374151;
    }
    .layout-slate .slate-seller-meta {
      color: #6B7280;
      line-height: 1.45;
      margin-top: 4px;
    }
    .layout-slate .slate-seller-meta p { margin: 0; }
    .layout-slate .slate-meta-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0;
      margin-bottom: 28px;
      border: 1px solid #D1D5DB;
    }
    .layout-slate .slate-meta-grid.slate-meta-single {
      grid-template-columns: 1fr;
    }
    .layout-slate .slate-meta-left {
      padding: 14px 18px;
    }
    .layout-slate .slate-meta-grid:not(.slate-meta-single) .slate-meta-left {
      border-right: 1px solid #D1D5DB;
    }
    .layout-slate .slate-meta-left p { margin: 0 0 4px; }
    .layout-slate .slate-meta-right { padding: 14px 18px; }
    .layout-slate .slate-meta-right p { margin: 0 0 4px; }
    .layout-slate .slate-bill-label { font-weight: 700; margin: 0 0 6px; }
    .layout-slate .slate-bill-name { font-weight: 700; margin: 0 0 4px; }
    .layout-slate table {
      width: 100%;
      margin: 0;
      border-collapse: collapse;
      border: 1px solid #D1D5DB;
      table-layout: fixed;
    }
    .layout-slate th,
    .layout-slate td {
      border: 1px solid #D1D5DB;
      padding: 9px 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .layout-slate th {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: ${ink};
      background: transparent;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .layout-slate th.num, .layout-slate td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .layout-slate th.qty, .layout-slate td.qty { text-align: center; }
    .layout-slate .slate-foot {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
      margin-top: 16px;
    }
    .layout-slate .slate-terms { flex: 1; min-width: 0; max-width: 52%; }
    .layout-slate .slate-terms-label { font-weight: 700; margin: 0 0 8px; }
    .layout-slate .slate-terms-body { color: #4B5563; line-height: 1.55; }
    .layout-slate .slate-terms-body p { margin: 0; }
    .layout-slate .slate-totals {
      width: 260px;
      max-width: 42%;
      margin-left: auto;
      flex-shrink: 0;
    }
    .layout-slate .slate-totals .totals { width: 100%; margin: 0; }
    .layout-slate .slate-totals .totals div {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-slate .slate-totals .totals .grand {
      font-weight: 800;
      font-size: ${typography.baseFontSize}px;
      color: ${ink};
      border: 1px solid #D1D5DB;
      padding: 8px 10px;
      margin-top: 4px;
    }
    .layout-slate .slate-thanks {
      margin-top: 36px;
      text-align: center;
    }
    .layout-slate .slate-thanks-big {
      font-size: ${Math.min(typography.headingFontSize + 4, 32)}px;
      font-weight: 900;
      margin: 0 0 6px;
    }
    .layout-slate .slate-thanks-sub { color: #6B7280; margin: 0; }
    .layout-slate .slate-thanks-sub p { margin: 0; }
    [dir="rtl"] .layout-slate .slate-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-slate th.num, [dir="rtl"] .layout-slate td.num { text-align: left; }
  `;
}

function buildSlateColgroup(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const weights: number[] = [];
  if (cols.description) weights.push(34);
  if (cols.sku) weights.push(10);
  if (cols.unitPrice) weights.push(12);
  if (cols.quantity) weights.push(8);
  if (cols.vatRate) weights.push(8);
  if (cols.vatAmount) weights.push(8);
  if (cols.discount !== false) weights.push(8);
  if (cols.lineTotal) weights.push(12);
  if (!weights.length) return '';
  const total = weights.reduce((sum, value) => sum + value, 0);
  return `<colgroup>${weights
    .map((weight) => `<col style="width:${((weight / total) * 100).toFixed(2)}%" />`)
    .join('')}</colgroup>`;
}

function buildSlateHeaders(config: TemplateConfig): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push('<th>Item description</th>');
  if (cols.sku) headers.push('<th class="num">SKU</th>');
  if (cols.unitPrice) headers.push('<th class="num">Price</th>');
  if (cols.quantity) headers.push('<th class="qty">Qty</th>');
  pushLineTableVatHeaders(headers, cols, (label) => `<th class="num">${label}</th>`);
  if (cols.discount !== false) headers.push('<th class="num">Disc %</th>');
  if (cols.lineTotal) headers.push('<th class="num">Total</th>');
  return headers.join('');
}

function buildSlateRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(`<td data-col="description">${esc(item.description)}</td>`);
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildSlateTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<div><span>${label(config, 'subtotal', 'Sub Total')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div><span>${label(config, 'vatTotal', 'Tax')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<div><span>${label(config, 'discount', 'Discount')}</span><span>${data.totals.discount} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<div class="grand"><span>${label(config, 'grandTotal', 'Grand Total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
    );
  }
  return `<div class="slate-totals"><div class="totals">${rows.join('')}</div></div>`;
}

function renderSlateLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const tableSection = config.sections.lineItems.visible
    ? `<table>${buildSlateColgroup(config)}<thead><tr>${buildSlateHeaders(config)}</tr></thead><tbody>${buildSlateRows(config, data)}</tbody></table>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const slateSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const f = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const sellerName =
    sellerVisible && f.legalName && hasText(data.seller.legalName)
      ? `<div class="slate-seller-name">${esc(data.seller.legalName)}</div>`
      : '';
  const sellerLines: string[] = [];
  if (sellerVisible) {
    if (f.address && hasText(data.seller.address.line1)) sellerLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    else if (f.address && hasText(data.seller.address.city)) sellerLines.push(`<p>${esc(data.seller.address.city)}</p>`);
    if (f.emirate && hasText(data.seller.address.emirate)) sellerLines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    if (f.trn && hasText(data.seller.trn)) sellerLines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    if (f.tradeLicence && hasText(data.seller.tradeLicence)) sellerLines.push(`<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`);
  }
  const sellerMeta = sellerLines.length ? `<div class="slate-seller-meta">${sellerLines.join('')}</div>` : '';

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const buyerLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) buyerLines.push(`<div class="slate-bill-name">${esc(data.buyer.name)}</div>`);
    if (bf.address && hasText(data.buyer.addressLine)) buyerLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) buyerLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) buyerLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const metaLeft = [
    hasText(data.invoiceNumber) ? `<p><strong>${esc(data.invoiceNumber)}</strong></p>` : '',
    hasText(data.issueDate) ? `<p>DATE:</p><p>${esc(data.issueDate)}</p>` : '',
  ].filter(Boolean).join('');

  const metaRight = buyerLines.length
    ? `<div class="slate-bill-label">${label(config, 'buyer', 'Bill To')}</div>${buyerLines.join('')}`
    : '';

  return `
    <div class="layout-slate">
      <div class="slate-sheet">
        <div class="slate-center-header">
          ${buildLogo(config)}
          ${title ? `<div class="slate-title">${title}</div>` : ''}
          ${sellerName}
          ${sellerMeta}
        </div>
        ${
          metaLeft && metaRight
            ? `<div class="slate-meta-grid">
                <div class="slate-meta-left">${metaLeft}</div>
                <div class="slate-meta-right">${metaRight}</div>
              </div>`
            : metaLeft
              ? `<div class="slate-meta-grid slate-meta-single"><div class="slate-meta-left">${metaLeft}</div></div>`
              : metaRight
                ? `<div class="slate-meta-grid slate-meta-single"><div class="slate-meta-right">${metaRight}</div></div>`
                : ''
        }
        ${tableSection}
        ${buildOrderNote(config, data)}
        <div class="slate-foot">
          <div class="slate-terms">
            ${
              showPay
                ? `<div class="slate-terms-label">Terms / payment info</div>
                   <div class="slate-terms-body">${terms}</div>`
                : ''
            }
            ${
              showNotes
                ? `<div class="slate-terms-label" style="margin-top:12px">Notes</div>
                   <div class="slate-terms-body">${rich(config.content.customNote.html)}</div>`
                : ''
            }
          </div>
          ${showPrices ? buildSlateTotals(config, data) : ''}
        </div>
        <div class="slate-thanks">
          ${richTextHasContent(thanks)
            ? `<div class="slate-thanks-big">THANK YOU!</div><div class="slate-thanks-sub">${thanks}</div>`
            : ''
          }
        </div>
        ${buildVerificationBlock(config, data)}
        ${slateSocial}
      </div>
    </div>`;
}

function charterStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const ink = branding.primaryColor || '#1B2A4E';
  return `
    .layout-charter {
      margin: -10mm;
      padding: 10mm;
      background: #E8E8E8;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-charter .charter-sheet {
      background: #fff;
      padding: 10mm 11mm 9mm;
      min-height: 245mm;
    }
    .layout-charter .charter-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-charter .charter-badge {
      background: ${ink};
      color: #fff;
      padding: 14px 28px;
      min-width: 160px;
      text-align: center;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      line-height: 1.05;
    }
    .layout-charter .charter-badge .document-title,
    .layout-charter .charter-badge .document-title p {
      margin: 0;
      color: #fff;
    }
    .layout-charter .charter-meta {
      text-align: right;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-charter .charter-meta-row {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin: 0 0 4px;
    }
    .layout-charter .charter-meta-row strong {
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-charter .charter-parties {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px 28px;
      margin-bottom: 24px;
    }
    .layout-charter .charter-parties .logo-wrap {
      grid-column: 1 / -1;
      margin: 0 0 4px;
    }
    .layout-charter .charter-table-section {
      width: 100%;
      margin-bottom: 8px;
    }
    .layout-charter .charter-table-area {
      width: 100%;
    }
    .layout-charter .charter-parties .logo { max-height: 44px; max-width: 140px; margin: 0; }
    .layout-charter .charter-kicker {
      font-size: ${typography.labelFontSize}px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-charter .charter-block { margin-bottom: 24px; }
    .layout-charter .charter-block-name { font-weight: 700; margin: 0 0 6px; }
    .layout-charter .charter-block-lines { color: #475569; line-height: 1.55; }
    .layout-charter .charter-block-lines p { margin: 0 0 4px; }
    .layout-charter .charter-contact { margin-top: 8px; }
    .layout-charter .charter-contact-item { margin: 0 0 10px; }
    .layout-charter .charter-contact-item strong {
      display: block;
      font-size: ${typography.labelFontSize}px;
      margin: 0 0 2px;
    }
    .layout-charter .charter-contact-item p { margin: 0; color: #475569; }
    .layout-charter .charter-table-wrap {
      border: 1px solid #E5E7EB;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      width: 100%;
      overflow: visible;
    }
    .layout-charter table {
      margin: 0;
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #E5E7EB;
    }
    .layout-charter thead th {
      background: ${ink};
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      padding: 9px 8px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .layout-charter tbody td {
      padding: 9px 8px;
      border: 1px solid #E5E7EB;
      vertical-align: top;
      background: #fff;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .layout-charter th.num, .layout-charter td.num { text-align: right; }
    .layout-charter th.qty, .layout-charter td.qty { text-align: center; }
    .layout-charter td.line-product { min-width: 0; }
    .layout-charter .line-product-row { gap: 10px; }
    .layout-charter .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    .layout-charter .line-product-title { font-size: ${typography.baseFontSize}px; }
    .layout-charter td[data-col="description"] { font-weight: 400; }
    .layout-charter td.num { font-weight: 700; font-variant-numeric: tabular-nums; }
    ${layoutTableDensityCss('layout-charter', 'charter', typography)}
    .layout-charter .charter-table-dense .line-barcode-img { height: 28px; }
    .layout-charter .charter-table-compact .line-barcode-img { height: 24px; }
    .layout-charter table thead th.num,
    .layout-charter table thead th.qty { white-space: nowrap; }
    .layout-charter .charter-totals {
      width: 280px;
      max-width: 100%;
      margin: 14px 0 0 auto;
    }
    .layout-charter .charter-totals .totals { width: 100%; margin: 0; }
    .layout-charter .charter-totals .totals div {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-charter .charter-totals .totals .tax-row {
      background: #F3F4F6;
      padding: 8px 10px;
      margin: 2px 0;
    }
    .layout-charter .charter-totals .totals .grand {
      font-weight: 800;
      font-size: ${typography.baseFontSize}px;
      color: #111827;
      border-top: 0;
      margin-top: 4px;
      padding-top: 8px;
    }
    .layout-charter .charter-foot {
      display: flex;
      justify-content: flex-end;
      gap: 24px;
      margin-top: 28px;
      align-items: flex-start;
    }
    .layout-charter .charter-terms-panel {
      background: #F3F4F6;
      padding: 14px 16px;
      margin-left: auto;
      width: 280px;
      max-width: 100%;
    }
    .layout-charter .charter-terms-panel .charter-kicker { margin-bottom: 6px; }
    .layout-charter .charter-terms-body { color: #475569; line-height: 1.55; }
    .layout-charter .charter-terms-body p { margin: 0; }
    .layout-charter .charter-notes {
      margin-top: 16px;
      color: #475569;
      line-height: 1.55;
    }
    .layout-charter .charter-thanks {
      margin-top: 36px;
      text-align: center;
      font-size: ${Math.min(typography.headingFontSize, 28)}px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #111827;
    }
    .layout-charter .charter-thanks p { margin: 0; }
    [dir="rtl"] .layout-charter .charter-meta { text-align: left; }
    [dir="rtl"] .layout-charter .charter-meta-row { justify-content: flex-start; }
    [dir="rtl"] .layout-charter .charter-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-charter .charter-terms-panel { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-charter th.num, [dir="rtl"] .layout-charter td.num { text-align: left; }
  `;
}

function buildCharterColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 34 },
      { key: 'sku', weight: 10 },
      { key: 'unitPrice', weight: 12 },
      { key: 'quantity', weight: 8 },
      { key: 'vatRate', weight: 9 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 13 },
    ])
  );
}

function buildCharterHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Item description', mode));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.unitPrice) headers.push(lineTableTh('Price', mode, 'num'));
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Total', mode, 'num'));
  return headers.join('');
}

function buildCharterRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildCharterTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<div><span>${label(config, 'subtotal', 'Sub Total')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div class="tax-row"><span>${label(config, 'vatTotal', 'Tax')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<div><span>${label(config, 'discount', 'Discount')}</span><span>${data.totals.discount} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<div class="grand"><span>${label(config, 'grandTotal', 'Grand Total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
    );
  }
  return `<div class="charter-totals"><div class="totals">${rows.join('')}</div></div>`;
}

function renderCharterLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('charter', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="charter-table-section${densityClass ? ` ${densityClass}` : ''}"><div class="charter-table-wrap"><table>${buildCharterColgroup(config)}<thead><tr>${buildCharterHeaders(config, density.mode)}</tr></thead><tbody>${buildCharterRows(config, data)}</tbody></table></div></div>`
    : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const charterSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const metaRows: string[] = [];
  if (hasText(data.invoiceNumber)) {
    metaRows.push(
      `<div class="charter-meta-row"><strong>${label(config, 'invoiceNumber', 'Invoice No.')}:</strong><span>${esc(data.invoiceNumber)}</span></div>`
    );
  }
  if (hasText(data.issueDate)) {
    metaRows.push(
      `<div class="charter-meta-row"><strong>${label(config, 'issueDate', 'Invoice Date')} :</strong><span>${esc(data.issueDate)}</span></div>`
    );
  }

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const buyerLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) buyerLines.push(`<div class="charter-block-name">${esc(data.buyer.name)}</div>`);
    if (bf.address && hasText(data.buyer.addressLine)) buyerLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) buyerLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) buyerLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const sf = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const sellerLines: string[] = [];
  if (sellerVisible) {
    if (sf.legalName && hasText(data.seller.legalName)) sellerLines.push(`<div class="charter-block-name">${esc(data.seller.legalName)}</div>`);
    if (sf.address && hasText(data.seller.address.line1)) sellerLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    else if (sf.address && hasText(data.seller.address.city)) sellerLines.push(`<p>${esc(data.seller.address.city)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) sellerLines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    if (sf.trn && hasText(data.seller.trn)) sellerLines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    if (sf.tradeLicence && hasText(data.seller.tradeLicence)) sellerLines.push(`<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`);
  }

  const contactItems: string[] = [];
  if (buyerVisible && bf.phone && hasText(data.buyer.phone)) {
    contactItems.push(`<div class="charter-contact-item"><strong>Phone</strong><p>${esc(data.buyer.phone ?? '')}</p></div>`);
  }
  if (buyerVisible && bf.email && hasText(data.buyer.email)) {
    contactItems.push(`<div class="charter-contact-item"><strong>Email</strong><p>${esc(data.buyer.email)}</p></div>`);
  }
  const contactBlock =
    contactItems.length > 0
      ? `<div class="charter-contact"><div class="charter-kicker">Contact</div>${contactItems.join('')}</div>`
      : '';

  return `
    <div class="layout-charter">
      <div class="charter-sheet">
        <div class="charter-top">
          <div class="charter-badge">${title || '<p><strong>INVOICE</strong></p>'}</div>
          ${metaRows.length ? `<div class="charter-meta">${metaRows.join('')}</div>` : ''}
        </div>
        <div class="charter-parties">
            ${buildLogo(config)}
            ${
              buyerLines.length
                ? `<div class="charter-block">
                    <div class="charter-kicker">${label(config, 'buyer', 'Invoice To')}</div>
                    <div class="charter-block-lines">${buyerLines.join('')}</div>
                  </div>`
                : ''
            }
            ${
              sellerLines.length
                ? `<div class="charter-block">
                    <div class="charter-kicker">Address</div>
                    <div class="charter-block-lines">${sellerLines.join('')}</div>
                  </div>`
                : ''
            }
            ${contactBlock}
        </div>
        <div class="charter-table-area">
            ${tableSection}
            ${showPrices ? buildCharterTotals(config, data) : ''}
        </div>
        ${
          showPay || showNotes
            ? `<div class="charter-foot">
                <div>
                  ${
                    showPay
                      ? `<div class="charter-terms-panel">
                          <div class="charter-kicker">Terms &amp; Condition</div>
                          <div class="charter-terms-body">${terms}</div>
                        </div>`
                      : ''
                  }
                  ${
                    showNotes
                      ? `<div class="charter-notes">
                          <div class="charter-kicker">Notes</div>
                          <div>${rich(config.content.customNote.html)}</div>
                        </div>`
                      : ''
                  }
                </div>
              </div>`
            : ''
        }
        ${buildOrderNote(config, data)}
        ${richTextHasContent(thanks) ? `<div class="charter-thanks">${thanks}</div>` : ''}
        ${buildVerificationBlock(config, data)}
        ${charterSocial}
      </div>
    </div>`;
}

function matrixStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const primary = branding.primaryColor || '#1E3A5F';
  const ink = darkInkOnLightBar(primary);
  const bar = lightTitleBarBackground(branding.accentColor || MATRIX_TITLE_BAR_FALLBACK, primary);
  return `
    .layout-matrix {
      margin: -10mm;
      padding: 10mm;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-matrix .matrix-sheet { min-height: 245mm; }
    .layout-matrix .matrix-frame {
      border: 1px solid #D1D5DB;
    }
    .layout-matrix .matrix-head,
    .layout-matrix .matrix-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .layout-matrix .matrix-head { border-bottom: 1px solid #D1D5DB; }
    .layout-matrix .matrix-meta { border-bottom: 1px solid #D1D5DB; }
    .layout-matrix .matrix-seller {
      padding: 14px 16px;
      border-right: 1px solid #D1D5DB;
    }
    .layout-matrix .matrix-seller .logo-wrap { margin: 0 0 8px; }
    .layout-matrix .matrix-seller .logo { max-height: 40px; max-width: 140px; margin: 0; }
    .layout-matrix .matrix-seller-name {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 6px;
      color: ${ink};
    }
    .layout-matrix .matrix-seller-lines { color: #475569; line-height: 1.5; }
    .layout-matrix .matrix-seller-lines p { margin: 0 0 3px; }
    .layout-matrix .matrix-title-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${bar};
      padding: 14px 16px;
    }
    .layout-matrix .matrix-title-bar .document-title,
    .layout-matrix .matrix-title-bar .document-title p {
      margin: 0;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${ink};
    }
    .layout-matrix .matrix-buyer {
      padding: 14px 16px;
      border-right: 1px solid #D1D5DB;
    }
    .layout-matrix .matrix-buyer-name { font-weight: 700; margin: 0 0 6px; }
    .layout-matrix .matrix-buyer-lines { color: #475569; line-height: 1.5; }
    .layout-matrix .matrix-buyer-lines p { margin: 0 0 3px; }
    .layout-matrix .matrix-ids {
      padding: 14px 16px;
      text-align: right;
      font-weight: 700;
      line-height: 1.55;
    }
    .layout-matrix .matrix-ids p { margin: 0 0 4px; }
    .layout-matrix table.matrix-grid {
      width: 100%;
      margin: 0;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .layout-matrix table.matrix-grid th,
    .layout-matrix table.matrix-grid td {
      border: 1px solid #D1D5DB;
      padding: 9px 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .layout-matrix table.matrix-grid thead th {
      background: #F3F4F6;
      color: ${ink};
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
      font-size: ${typography.labelFontSize}px;
    }
    .layout-matrix table.matrix-grid th.num,
    .layout-matrix table.matrix-grid td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .layout-matrix table.matrix-grid th.qty,
    .layout-matrix table.matrix-grid td.qty { text-align: center; }
    .layout-matrix table.matrix-grid td.num { font-weight: 700; }
    .layout-matrix table.matrix-grid td.line-product { min-width: 0; }
    .layout-matrix .line-product-row { gap: 10px; }
    .layout-matrix .line-product-thumb-wrap { width: 36px; height: 36px; flex-shrink: 0; }
    .layout-matrix table.matrix-summary td {
      border: 1px solid #D1D5DB;
      padding: 8px;
      vertical-align: middle;
    }
    .layout-matrix table.matrix-summary td.matrix-sum-label {
      text-align: right;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      color: ${ink};
      font-size: ${typography.labelFontSize}px;
    }
    .layout-matrix table.matrix-summary td.num {
      text-align: right;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .layout-matrix table.matrix-summary tr.grand td {
      font-size: ${typography.baseFontSize}px;
    }
    .layout-matrix .matrix-note {
      padding: 12px 16px;
      color: #6B7280;
      font-size: ${typography.labelFontSize}px;
      line-height: 1.5;
      border-top: 1px solid #D1D5DB;
    }
    .layout-matrix .matrix-note p { margin: 0; }
    .layout-matrix .matrix-foot {
      margin-top: 24px;
      text-align: center;
      color: #6B7280;
    }
    .layout-matrix .matrix-foot p { margin: 0; }
    ${layoutTableDensityCss('layout-matrix', 'matrix', typography, 'matrix-grid')}
    .layout-matrix table.matrix-grid thead th.num,
    .layout-matrix table.matrix-grid thead th.qty { white-space: nowrap; }
    [dir="rtl"] .layout-matrix .matrix-ids { text-align: left; }
    [dir="rtl"] .layout-matrix table.matrix-summary td.matrix-sum-label { text-align: left; }
    [dir="rtl"] .layout-matrix th.num, [dir="rtl"] .layout-matrix td.num { text-align: left; }
  `;
}

function buildMatrixColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 36 },
      { key: 'sku', weight: 10 },
      { key: 'quantity', weight: 8 },
      { key: 'unitPrice', weight: 12 },
      { key: 'vatRate', weight: 9 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 13 },
    ])
  );
}

function matrixLabelColspan(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  let count = 0;
  if (cols.description) count++;
  if (cols.sku) count++;
  if (cols.quantity) count++;
  if (cols.unitPrice) count++;
  if (cols.vatRate) count++;
  if (cols.vatAmount) count++;
  if (cols.discount !== false) count++;
  return count;
}

function buildMatrixHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Item description', mode));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.quantity) headers.push(lineTableTh('Qty.', mode, 'qty'));
  if (cols.unitPrice) headers.push(lineTableTh('Rate', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildMatrixRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildMatrixSummary(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData
): string {
  if (!config.sections.totals.visible || !config.sections.lineItems.columns.lineTotal) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const span = matrixLabelColspan(config);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<tr><td colspan="${span}" class="matrix-sum-label">${label(config, 'subtotal', 'Net Total')}</td><td class="num">${data.totals.subtotal} ${cur}</td></tr>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<tr><td colspan="${span}" class="matrix-sum-label">${label(config, 'vatTotal', 'Tax')}</td><td class="num">${data.totals.vatTotal} ${cur}</td></tr>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<tr><td colspan="${span}" class="matrix-sum-label">${label(config, 'discount', 'Discount')}</td><td class="num">${data.totals.discount} ${cur}</td></tr>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<tr><td colspan="${span}" class="matrix-sum-label">${label(config, 'shipping', 'Shipping')}</td><td class="num">${data.totals.shipping} ${cur}</td></tr>`
    );
  }
  if (t.showGrandTotal) {
    rows.push(
      `<tr class="grand"><td colspan="${span}" class="matrix-sum-label">${label(config, 'grandTotal', 'Grand Total')}</td><td class="num">${data.totals.grandTotal} ${cur}</td></tr>`
    );
  }
  if (!rows.length) return '';
  return `<table class="matrix-grid matrix-summary">${buildMatrixColgroup(config)}<tbody>${rows.join('')}</tbody></table>`;
}

function renderMatrixLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('matrix', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="${densityClass}"><table class="matrix-grid">${buildMatrixColgroup(config)}<thead><tr>${buildMatrixHeaders(config, density.mode)}</tr></thead><tbody>${buildMatrixRows(config, data)}</tbody></table>${showPrices ? buildMatrixSummary(config, data) : ''}</div>`
    : showPrices
      ? buildMatrixSummary(config, data)
      : '';
  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const matrixSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const sf = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const sellerLines: string[] = [];
  if (sellerVisible) {
    if (sf.legalName && hasText(data.seller.legalName)) sellerLines.push(`<p class="matrix-seller-name">${esc(data.seller.legalName)}</p>`);
    if (sf.address && hasText(data.seller.address.line1)) sellerLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    else if (sf.address && hasText(data.seller.address.city)) sellerLines.push(`<p>${esc(data.seller.address.city)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) sellerLines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    if (sf.trn && hasText(data.seller.trn)) sellerLines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    if (sf.tradeLicence && hasText(data.seller.tradeLicence)) sellerLines.push(`<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`);
  }

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const buyerLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) buyerLines.push(`<p class="matrix-buyer-name">${esc(data.buyer.name)}</p>`);
    if (bf.address && hasText(data.buyer.addressLine)) buyerLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) buyerLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) buyerLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const idLines = [
    hasText(data.invoiceNumber) ? `<p>${esc(data.invoiceNumber)}</p>` : '',
    hasText(data.issueDate) ? `<p>${esc(data.issueDate)}</p>` : '',
  ].filter(Boolean);

  const noteParts = [
    showPay ? `<div class="matrix-terms">${terms}</div>` : '',
    showNotes ? `<div>${rich(config.content.customNote.html)}</div>` : '',
  ].filter(Boolean);

  return `
    <div class="layout-matrix">
      <div class="matrix-sheet">
        <div class="matrix-frame">
          <div class="matrix-head">
            <div class="matrix-seller">
              ${buildLogo(config)}
              ${sellerLines.length ? `<div class="matrix-seller-lines">${sellerLines.join('')}</div>` : ''}
            </div>
            <div class="matrix-title-bar">${title || '<p><strong>INVOICE</strong></p>'}</div>
          </div>
          <div class="matrix-meta">
            <div class="matrix-buyer">
              ${buyerLines.length ? `<div class="matrix-buyer-lines">${buyerLines.join('')}</div>` : ''}
            </div>
            <div class="matrix-ids">${idLines.join('')}</div>
          </div>
          ${tableSection}
          ${noteParts.length ? `<div class="matrix-note">${noteParts.join('')}</div>` : ''}
        </div>
        ${buildOrderNote(config, data)}
        ${richTextHasContent(thanks) ? `<div class="matrix-foot">${thanks}</div>` : ''}
        ${buildVerificationBlock(config, data)}
        ${matrixSocial}
      </div>
    </div>`;
}

function emberColumnCount(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  let count = 0;
  if (cols.description) count++;
  if (cols.sku) count++;
  if (cols.unitPrice) count++;
  if (cols.quantity) count++;
  if (cols.vatRate) count++;
  if (cols.discount !== false) count++;
  if (cols.lineTotal) count++;
  return count;
}

function emberLabelColspan(config: TemplateConfig): number {
  const count = emberColumnCount(config);
  return count > 1 ? count - 1 : 1;
}

function buildEmberColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 36 },
      { key: 'sku', weight: 10 },
      { key: 'quantity', weight: 8 },
      { key: 'unitPrice', weight: 12 },
      { key: 'vatRate', weight: 10 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 14 },
    ])
  );
}

function buildEmberHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Description', mode));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  if (cols.unitPrice) headers.push(lineTableTh('Rate', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildEmberRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildEmberTableFoot(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const span = emberLabelColspan(config);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<tr class="ember-sum-row"><td colspan="${span}" class="ember-sum-label">${label(config, 'subtotal', 'Subtotal')}</td><td class="num">${data.totals.subtotal} ${cur}</td></tr>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<tr class="ember-sum-row"><td colspan="${span}" class="ember-sum-label">${label(config, 'discount', 'Discount')}</td><td class="num">${data.totals.discount} ${cur}</td></tr>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<tr class="ember-sum-row"><td colspan="${span}" class="ember-sum-label">${label(config, 'vatTotal', 'VAT Total')}</td><td class="num">${data.totals.vatTotal} ${cur}</td></tr>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<tr class="ember-sum-row"><td colspan="${span}" class="ember-sum-label">${label(config, 'shipping', 'Shipping')}</td><td class="num">${data.totals.shipping} ${cur}</td></tr>`
    );
  }
  if (!rows.length) return '';
  return `<tfoot>${rows.join('')}</tfoot>`;
}

function buildEmberGrandTotal(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible || !config.sections.totals.showGrandTotal) return '';
  const cur = esc(data.currency);
  return `<div class="ember-grand">
    <span class="ember-grand-label">${label(config, 'grandTotal', 'Total')}</span>
    <span class="ember-grand-amount"><span class="ember-grand-cur">${cur}</span> ${data.totals.grandTotal}</span>
  </div>`;
}

function emberStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const accent = branding.primaryColor || '#F97316';
  return `
    .layout-ember {
      margin: -10mm;
      padding: 10mm;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-ember .ember-sheet { min-height: 245mm; }
    .layout-ember .ember-header {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 16px;
      align-items: start;
      margin-bottom: 20px;
    }
    .layout-ember .ember-header .logo-wrap { margin: 0; }
    .layout-ember .ember-header .logo { max-height: 44px; max-width: 120px; margin: 0; }
    .layout-ember .ember-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      line-height: 1.15;
    }
    .layout-ember .ember-title-row .document-title {
      margin: 0;
      font-size: ${typography.headingFontSize}px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.02em;
    }
    .layout-ember .ember-title-row .document-title p { margin: 0; display: inline; }
    .layout-ember .ember-title-sep,
    .layout-ember .ember-buyer-in-title {
      font-size: ${typography.headingFontSize}px;
      font-weight: 700;
      color: #111827;
    }
    .layout-ember .ember-meta-line {
      margin-top: 6px;
      color: #6B7280;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-ember .ember-meta-line strong { color: #374151; font-weight: 600; }
    .layout-ember .ember-addresses {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }
    .layout-ember .ember-addr-kicker {
      font-weight: 700;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-ember .ember-addr-lines { color: #374151; line-height: 1.55; }
    .layout-ember .ember-addr-lines p { margin: 0 0 3px; }
    .layout-ember .ember-body {
      display: grid;
      grid-template-columns: minmax(148px, 28%) 1fr;
      gap: 0;
      align-items: stretch;
    }
    .layout-ember .ember-body.ember-body-single { grid-template-columns: 1fr; }
    .layout-ember .ember-sidebar {
      padding: 0 20px 0 0;
      border-right: 1px solid #E5E7EB;
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-ember .ember-sidebar-kicker {
      color: ${accent};
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: ${typography.labelFontSize}px;
      margin: 0 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #E5E7EB;
    }
    .layout-ember .ember-sidebar-field { margin: 0 0 14px; }
    .layout-ember .ember-sidebar-field .label {
      display: block;
      color: #9CA3AF;
      font-size: ${Math.max(typography.labelFontSize - 1, 9)}px;
      margin: 0 0 3px;
    }
    .layout-ember .ember-sidebar-field .value {
      color: #111827;
      font-size: ${typography.baseFontSize}px;
      line-height: 1.45;
    }
    .layout-ember .ember-sidebar-field .value p { margin: 0; }
    .layout-ember .ember-sidebar-terms {
      color: #374151;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-ember .ember-sidebar-terms p { margin: 0 0 4px; }
    .layout-ember .ember-sidebar-thanks {
      margin-top: auto;
      padding-top: 24px;
      color: ${accent};
      font-weight: 600;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-ember .ember-sidebar-thanks p { margin: 0; }
    .layout-ember .ember-main { padding-left: 20px; min-width: 0; }
    .layout-ember .ember-main-full { padding-left: 0; }
    .layout-ember .ember-table-wrap { overflow: visible; }
    ${uniformGridTableBorderCss('.layout-ember table.ember-grid')}
    .layout-ember table.ember-grid thead th {
      background: #F3F4F6;
      color: #374151;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      padding: 10px 8px;
      text-align: left;
    }
    .layout-ember table.ember-grid tbody td {
      padding: 10px 8px;
      color: #111827;
    }
    .layout-ember table.ember-grid thead th.num,
    .layout-ember table.ember-grid thead th.qty { text-align: right; }
    .layout-ember table.ember-grid tbody td.num,
    .layout-ember table.ember-grid tbody td.qty {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: #111827;
    }
    .layout-ember table.ember-grid tbody td.qty { font-weight: 500; }
    .layout-ember table.ember-grid td.line-product { min-width: 0; font-weight: 600; }
    .layout-ember .line-product-row { gap: 10px; }
    .layout-ember .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    .layout-ember tfoot .ember-sum-row td {
      background: #F3F4F6;
      border: 1px solid #E5E7EB;
      padding: 8px;
      color: #111827;
    }
    .layout-ember tfoot .ember-sum-label { text-align: right; font-weight: 600; }
    .layout-ember tfoot td.num { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
    ${layoutTableDensityCss('layout-ember', 'ember', typography, 'ember-grid')}
    .layout-ember table.ember-grid thead th.num,
    .layout-ember table.ember-grid thead th.qty { white-space: nowrap; }
    .layout-ember .ember-grand {
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 12px;
      margin-top: 14px;
      padding-right: 4px;
    }
    .layout-ember .ember-grand-label {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 2}px;
      color: #111827;
    }
    .layout-ember .ember-grand-amount {
      font-weight: 800;
      font-size: ${typography.headingFontSize + 4}px;
      color: ${accent};
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .layout-ember .ember-grand-cur {
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      font-weight: 700;
      vertical-align: super;
      margin-right: 2px;
    }
    .layout-ember .ember-page-foot {
      margin-top: 28px;
      background: #F3F4F6;
      padding: 16px 20px;
      text-align: center;
    }
    .layout-ember .ember-foot-thanks {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 3}px;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-ember .ember-foot-contact {
      color: #374151;
      font-size: ${typography.baseFontSize}px;
      line-height: 1.5;
    }
    .layout-ember .ember-foot-contact a {
      color: inherit;
      text-decoration: underline;
    }
    .layout-ember .ember-foot-contact .social-links {
      justify-content: center;
      margin: 0;
    }
    .layout-ember .verification-qr { margin-top: 16px; }
    [dir="rtl"] .layout-ember .ember-body { direction: rtl; }
    [dir="rtl"] .layout-ember .ember-sidebar {
      padding: 0 0 0 20px;
      border-right: 0;
      border-left: 1px solid #E5E7EB;
    }
    [dir="rtl"] .layout-ember .ember-main { padding-left: 0; padding-right: 20px; }
    [dir="rtl"] .layout-ember table.ember-grid thead th.num,
    [dir="rtl"] .layout-ember table.ember-grid thead th.qty,
    [dir="rtl"] .layout-ember table.ember-grid tbody td.num,
    [dir="rtl"] .layout-ember table.ember-grid tbody td.qty { text-align: left; }
    [dir="rtl"] .layout-ember tfoot .ember-sum-label { text-align: left; }
    [dir="rtl"] .layout-ember .ember-grand { justify-content: flex-start; }
  `;
}

function renderEmberLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('ember', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="ember-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="ember-grid">${buildEmberColgroup(config)}<thead><tr>${buildEmberHeaders(config, density.mode)}</tr></thead><tbody>${buildEmberRows(config, data)}</tbody>${showPrices ? buildEmberTableFoot(config, data) : ''}</table>${showPrices ? buildEmberGrandTotal(config, data) : ''}</div>`
    : showPrices
      ? buildEmberGrandTotal(config, data)
      : '';

  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const emberSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const sf = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const fromLines: string[] = [];
  if (sellerVisible) {
    if (sf.legalName && hasText(data.seller.legalName)) fromLines.push(`<p><strong>${esc(data.seller.legalName)}</strong></p>`);
    if (sf.address && hasText(data.seller.address.line1)) fromLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) fromLines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    else if (sf.address && hasText(data.seller.address.city)) fromLines.push(`<p>${esc(data.seller.address.city)}</p>`);
    if (sf.trn && hasText(data.seller.trn)) fromLines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    if (sf.tradeLicence && hasText(data.seller.tradeLicence)) fromLines.push(`<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`);
  }

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const toLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) toLines.push(`<p><strong>${esc(data.buyer.name)}</strong></p>`);
    if (bf.address && hasText(data.buyer.addressLine)) toLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) toLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) toLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const metaParts: string[] = [];
  if (hasText(data.invoiceNumber)) {
    metaParts.push(
      `<strong>${label(config, 'invoiceNumber', 'No.')} </strong>${esc(data.invoiceNumber)}`
    );
  }
  if (hasText(data.issueDate)) {
    metaParts.push(
      `<strong>${label(config, 'issueDate', 'Date')} </strong>${esc(data.issueDate)}`
    );
  }

  const buyerInTitle =
    buyerVisible && bf.name && hasText(data.buyer.name)
      ? `<span class="ember-title-sep">|</span><span class="ember-buyer-in-title">${esc(data.buyer.name)}</span>`
      : '';

  const sidebarFields: string[] = [];
  if (sellerVisible && sf.legalName && hasText(data.seller.legalName)) {
    sidebarFields.push(
      `<div class="ember-sidebar-field"><span class="label">Account name</span><div class="value">${esc(data.seller.legalName)}</div></div>`
    );
  }
  if (showNotes) {
    sidebarFields.push(
      `<div class="ember-sidebar-field"><span class="label">${label(config, 'orderNote', 'Notes')}</span><div class="value">${rich(config.content.customNote.html)}</div></div>`
    );
  }
  if (showPay) {
    sidebarFields.push(
      `<div class="ember-sidebar-field"><span class="label">Payment terms</span><div class="ember-sidebar-terms">${terms}</div></div>`
    );
  }

  const showSidebar =
    sidebarFields.length > 0 || richTextHasContent(thanks);
  const sidebarThanks = richTextHasContent(thanks)
    ? `<div class="ember-sidebar-thanks">${thanks}</div>`
    : '';

  const pageFoot =
    emberSocial || richTextHasContent(thanks)
      ? `<div class="ember-page-foot">
          <div class="ember-foot-thanks">Thank you!</div>
          ${emberSocial ? `<div class="ember-foot-contact">${emberSocial}</div>` : ''}
        </div>`
      : '';

  return `
    <div class="layout-ember">
      <div class="ember-sheet">
        <div class="ember-header">
          ${buildLogo(config)}
          <div class="ember-headline">
            <div class="ember-title-row">
              ${title || '<div class="document-title"><p>Invoice</p></div>'}
              ${buyerInTitle}
            </div>
            ${metaParts.length ? `<div class="ember-meta-line">${metaParts.join(' <span aria-hidden="true">|</span> ')}</div>` : ''}
          </div>
        </div>
        ${
          fromLines.length || toLines.length
            ? `<div class="ember-addresses">
                ${
                  fromLines.length
                    ? `<div class="ember-from">
                        <div class="ember-addr-kicker">${label(config, 'seller', 'From')}</div>
                        <div class="ember-addr-lines">${fromLines.join('')}</div>
                      </div>`
                    : ''
                }
                ${
                  toLines.length
                    ? `<div class="ember-to">
                        <div class="ember-addr-kicker">${label(config, 'buyer', 'To')}</div>
                        <div class="ember-addr-lines">${toLines.join('')}</div>
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }
        <div class="ember-body${showSidebar ? '' : ' ember-body-single'}">
          ${
            showSidebar
              ? `<aside class="ember-sidebar">
                  ${sidebarFields.length ? `<div class="ember-sidebar-kicker">Payment info</div>${sidebarFields.join('')}` : ''}
                  ${sidebarThanks}
                </aside>`
              : ''
          }
          <main class="ember-main${showSidebar ? '' : ' ember-main-full'}">
            ${tableSection}
            ${buildOrderNote(config, data)}
            ${buildVerificationBlock(config, data)}
          </main>
        </div>
        ${pageFoot}
      </div>
    </div>`;
}

function summitMoneyCell(amount: string, currency: string): string {
  return `<td class="num summit-money"><span class="summit-cur">${esc(currency)}</span><span class="summit-amt">${amount}</span></td>`;
}

function summitColumnCount(config: TemplateConfig): number {
  const cols = config.sections.lineItems.columns;
  let count = 0;
  if (cols.description) count++;
  if (cols.sku) count++;
  if (cols.unitPrice) count++;
  if (cols.quantity) count++;
  if (cols.vatRate) count++;
  if (cols.discount !== false) count++;
  if (cols.lineTotal) count++;
  return count;
}

function summitLabelColspan(config: TemplateConfig): number {
  const count = summitColumnCount(config);
  return count > 1 ? count - 1 : 1;
}

function buildSummitColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 38 },
      { key: 'sku', weight: 10 },
      { key: 'unitPrice', weight: 12 },
      { key: 'quantity', weight: 10 },
      { key: 'vatRate', weight: 10 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 14 },
    ])
  );
}

function buildSummitHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Description', mode));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.unitPrice) headers.push(lineTableTh('Price', mode, 'num'));
  if (cols.quantity) headers.push(lineTableTh('Quantity', mode, 'qty'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildSummitRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  const cur = esc(data.currency);
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildDescriptionCell(config, item));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(summitMoneyCell(item.unitPrice, cur));
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(summitMoneyCell(item.lineTotal, cur));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildSummitTableFoot(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const span = summitLabelColspan(config);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<tr class="summit-sum-row"><td colspan="${span}" class="summit-sum-label">${label(config, 'subtotal', 'Subtotal')}</td><td class="num">${data.totals.subtotal} ${cur}</td></tr>`
    );
  }
  if (t.showDiscount && !isZeroMoney(data.totals.discount)) {
    rows.push(
      `<tr class="summit-sum-row"><td colspan="${span}" class="summit-sum-label">${label(config, 'discount', 'Discount')}</td><td class="num">${data.totals.discount} ${cur}</td></tr>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<tr class="summit-sum-row"><td colspan="${span}" class="summit-sum-label">${label(config, 'vatTotal', 'VAT Total')}</td><td class="num">${data.totals.vatTotal} ${cur}</td></tr>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<tr class="summit-sum-row"><td colspan="${span}" class="summit-sum-label">${label(config, 'shipping', 'Shipping')}</td><td class="num">${data.totals.shipping} ${cur}</td></tr>`
    );
  }
  if (!rows.length) return '';
  return `<tfoot>${rows.join('')}</tfoot>`;
}

function buildSummitGrandTotal(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible || !config.sections.totals.showGrandTotal) return '';
  const cur = esc(data.currency);
  return `<div class="summit-grand">
    <span class="summit-grand-label">${label(config, 'grandTotal', 'Total')}</span>
    <span class="summit-grand-amount"><span class="summit-grand-cur">${cur}</span>${data.totals.grandTotal}</span>
  </div>`;
}

function buildSummitHeaderBar(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const f = config.sections.seller.fields;
  const showSeller = config.sections.seller.visible !== false;
  const orange = config.branding.primaryColor || '#F97316';
  const name =
    showSeller && f.legalName && hasText(data.seller.legalName)
      ? `<div class="summit-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const subtitle = docSubtitle(config);
  const subtitleBlock = subtitle
    ? `<div class="summit-brand-tag document-subtitle" style="color:${orange}">${subtitle}</div>`
    : '';
  const contactLines: string[] = [];
  if (showSeller) {
    if (f.address && hasText(data.seller.address.line1)) {
      contactLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    }
    if (f.emirate && hasText(data.seller.address.emirate)) {
      contactLines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    } else if (f.address && hasText(data.seller.address.city)) {
      contactLines.push(`<p>${esc(data.seller.address.city)}</p>`);
    }
    if (f.trn && hasText(data.seller.trn)) {
      contactLines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    }
  }
  const logo = buildLogo(config);
  const brandInner = logo || name ? `${logo}${name}${subtitleBlock}` : '';
  if (!brandInner && !contactLines.length) return '';
  return `<div class="summit-bar">
    <div class="summit-brand">${brandInner}</div>
    ${contactLines.length ? `<div class="summit-contact">${contactLines.join('')}</div>` : ''}
  </div>`;
}

function summitStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const orange = branding.primaryColor || '#F97316';
  const bar = branding.accentColor || '#111111';
  return `
    .layout-summit {
      margin: -10mm;
      padding: 0;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-summit .summit-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      background: ${bar};
      color: #fff;
      padding: 22px 10mm;
      margin: 0 0 24px;
    }
    .layout-summit .summit-brand .logo-wrap { margin: 0 0 8px; text-align: left; }
    .layout-summit .summit-brand .logo { max-height: 44px; max-width: 160px; margin: 0; }
    .layout-summit .summit-brand-name {
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
      color: #fff;
    }
    .layout-summit .summit-brand-tag {
      margin-top: 4px;
      font-size: ${Math.max(typography.baseFontSize, 13)}px;
      font-weight: 600;
      line-height: 1.3;
    }
    .layout-summit .summit-brand-tag p { margin: 0; }
    .layout-summit .summit-contact {
      text-align: right;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
      color: rgba(255,255,255,0.92);
      min-width: 180px;
    }
    .layout-summit .summit-contact p { margin: 0 0 3px; }
    .layout-summit .summit-sheet { padding: 0 10mm 10mm; }
    .layout-summit .summit-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
      margin-bottom: 22px;
    }
    .layout-summit .summit-to-label {
      font-weight: 700;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-summit .summit-to-name { font-weight: 700; margin: 0 0 6px; }
    .layout-summit .summit-to-lines { color: #6B7280; line-height: 1.55; }
    .layout-summit .summit-to-lines p { margin: 0 0 3px; }
    .layout-summit .summit-title-block { text-align: right; }
    .layout-summit .summit-title-block .document-title {
      margin: 0 0 8px;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.02em;
    }
    .layout-summit .summit-title-block .document-title p { margin: 0; }
    .layout-summit .summit-ids { color: #374151; line-height: 1.55; }
    .layout-summit .summit-ids p { margin: 0 0 3px; }
    .layout-summit .summit-table-wrap { overflow: visible; margin-bottom: 8px; }
    ${uniformGridTableBorderCss('.layout-summit table.summit-grid')}
    .layout-summit table.summit-grid thead th,
    .layout-summit table.summit-grid tbody td {
      padding: 10px 8px;
      color: #111827;
    }
    .layout-summit table.summit-grid thead th {
      background: #F3F4F6;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      text-align: left;
    }
    .layout-summit table.summit-grid thead th.num,
    .layout-summit table.summit-grid thead th.qty { text-align: center; }
    .layout-summit table.summit-grid tbody td.num,
    .layout-summit table.summit-grid tbody td.qty {
      text-align: center;
    }
    .layout-summit table.summit-grid td.line-product { min-width: 0; font-weight: 600; }
    .layout-summit .summit-money {
      text-align: center;
      vertical-align: middle;
    }
    .layout-summit .summit-cur {
      display: block;
      font-size: ${Math.max(typography.labelFontSize - 1, 9)}px;
      font-weight: 600;
      color: #6B7280;
      line-height: 1.1;
      margin-bottom: 2px;
    }
    .layout-summit .summit-amt {
      display: block;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #111827;
    }
    .layout-summit .line-product-row { gap: 10px; }
    .layout-summit .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    .layout-summit tfoot .summit-sum-row td {
      background: #F3F4F6;
      border: 1px solid #E5E7EB;
      padding: 8px;
      color: #111827;
    }
    .layout-summit tfoot .summit-sum-label { text-align: right; font-weight: 700; }
    .layout-summit tfoot td.num { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    ${layoutTableDensityCss('layout-summit', 'summit', typography, 'summit-grid')}
    .layout-summit table.summit-grid thead th.num,
    .layout-summit table.summit-grid thead th.qty { white-space: nowrap; }
    .layout-summit .summit-grand {
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 14px;
      margin: 12px 0 28px;
      padding-right: 4px;
    }
    .layout-summit .summit-grand-label {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 2}px;
      color: #111827;
    }
    .layout-summit .summit-grand-amount {
      font-weight: 800;
      font-size: ${typography.headingFontSize + 6}px;
      color: ${orange};
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .layout-summit .summit-grand-cur {
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      font-weight: 700;
      vertical-align: super;
      margin-right: 4px;
    }
    .layout-summit .summit-lower {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
      margin-bottom: 24px;
    }
    .layout-summit .summit-lower.summit-lower-single { grid-template-columns: 1fr; }
    .layout-summit .summit-lower.summit-lower-single .summit-pay { text-align: inherit; }
    .layout-summit .summit-lower-kicker {
      font-weight: 800;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-summit .summit-terms-body {
      color: ${orange};
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-summit .summit-terms-body p { margin: 0 0 4px; }
    .layout-summit .summit-pay-info {
      text-align: right;
      color: #374151;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-summit .summit-pay-info p { margin: 0 0 3px; }
    .layout-summit .summit-pay-info .social-links { justify-content: flex-end; margin: 0; }
    .layout-summit .summit-page-foot {
      background: #F3F4F6;
      padding: 16px 10mm;
      margin: 0 -10mm -10mm;
      text-align: center;
    }
    .layout-summit .summit-foot-thanks {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 3}px;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-summit .summit-foot-contact {
      color: #374151;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-summit .summit-foot-contact a { color: inherit; text-decoration: underline; }
    .layout-summit .summit-foot-contact .social-links { justify-content: center; margin: 0; }
    .layout-summit .verification-qr { margin-top: 16px; }
    [dir="rtl"] .layout-summit .summit-contact { text-align: left; }
    [dir="rtl"] .layout-summit .summit-title-block { text-align: left; }
    [dir="rtl"] .layout-summit .summit-pay-info { text-align: left; }
    [dir="rtl"] .layout-summit .summit-pay-info .social-links { justify-content: flex-start; }
    [dir="rtl"] .layout-summit .summit-grand { justify-content: flex-start; }
    [dir="rtl"] .layout-summit tfoot .summit-sum-label { text-align: left; }
  `;
}

function renderSummitLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('summit', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="summit-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="summit-grid">${buildSummitColgroup(config)}<thead><tr>${buildSummitHeaders(config, density.mode)}</tr></thead><tbody>${buildSummitRows(config, data)}</tbody>${showPrices ? buildSummitTableFoot(config, data) : ''}</table>${showPrices ? buildSummitGrandTotal(config, data) : ''}</div>`
    : showPrices
      ? buildSummitGrandTotal(config, data)
      : '';

  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const summitSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const toLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) toLines.push(`<div class="summit-to-name">${esc(data.buyer.name)}</div>`);
    if (bf.address && hasText(data.buyer.addressLine)) toLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) toLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) toLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const idLines: string[] = [];
  if (hasText(data.invoiceNumber)) {
    idLines.push(`<p>${label(config, 'invoiceNumber', 'No.')} ${esc(data.invoiceNumber)}</p>`);
  }
  if (hasText(data.issueDate)) {
    idLines.push(`<p>${label(config, 'issueDate', 'Date')} ${esc(data.issueDate)}</p>`);
  }

  const lowerLeft = showPay
    ? `<div class="summit-terms">
        <div class="summit-lower-kicker">Payment terms</div>
        <div class="summit-terms-body">${terms}</div>
      </div>`
    : showNotes
      ? `<div class="summit-notes">
          <div class="summit-lower-kicker">${label(config, 'orderNote', 'Notes')}</div>
          <div class="summit-terms-body">${rich(config.content.customNote.html)}</div>
        </div>`
      : '';

  const payInfoParts: string[] = [];
  if (showNotes && showPay) {
    payInfoParts.push(`<div>${rich(config.content.customNote.html)}</div>`);
  }
  if (summitSocial) payInfoParts.push(summitSocial);

  const lowerRight =
    payInfoParts.length > 0
      ? `<div class="summit-pay">
          <div class="summit-lower-kicker">Payment info</div>
          <div class="summit-pay-info">${payInfoParts.join('')}</div>
        </div>`
      : '';

  const lowerSection =
    lowerLeft || lowerRight
      ? `<div class="summit-lower${!lowerLeft || !lowerRight ? ' summit-lower-single' : ''}">
          ${lowerLeft}
          ${lowerRight}
        </div>`
      : '';

  const pageFoot = summitSocial
    ? `<div class="summit-page-foot">
        <div class="summit-foot-thanks">Thank you!</div>
        <div class="summit-foot-contact">${summitSocial}</div>
      </div>`
    : '';

  return `
    <div class="layout-summit">
      ${buildSummitHeaderBar(config, data)}
      <div class="summit-sheet">
        <div class="summit-meta">
          ${
            toLines.length
              ? `<div class="summit-to">
                  <div class="summit-to-label">${label(config, 'buyer', 'To')}</div>
                  <div class="summit-to-lines">${toLines.join('')}</div>
                </div>`
              : '<div></div>'
          }
          <div class="summit-title-block">
            ${title || '<div class="document-title"><p>Invoice</p></div>'}
            ${idLines.length ? `<div class="summit-ids">${idLines.join('')}</div>` : ''}
          </div>
        </div>
        ${tableSection}
        ${buildOrderNote(config, data)}
        ${buildVerificationBlock(config, data)}
        ${lowerSection}
      </div>
      ${pageFoot}
    </div>`;
}

function buildFlareSellerSection(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const sf = config.sections.seller.fields;
  const showSeller = config.sections.seller.visible !== false;
  const logo = buildLogo(config);
  const orange = config.branding.primaryColor || '#F97316';
  const lines: string[] = [];

  if (showSeller) {
    if (sf.address && hasText(data.seller.address.line1)) lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) {
      lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
    } else if (sf.address && hasText(data.seller.address.city)) {
      lines.push(`<p>${esc(data.seller.address.city)}</p>`);
    }
    if (sf.trn && hasText(data.seller.trn)) {
      lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    }
    if (sf.tradeLicence && hasText(data.seller.tradeLicence)) {
      lines.push(`<p>${label(config, 'tradeLicence', 'Trade Licence')}: ${esc(data.seller.tradeLicence)}</p>`);
    }
  }

  const nameBlock =
    showSeller && sf.legalName && hasText(data.seller.legalName)
      ? `<div class="flare-seller-name">${esc(data.seller.legalName)}</div>`
      : '';
  const subtitle = docSubtitle(config);
  const tagBlock = subtitle
    ? `<div class="flare-seller-tag document-subtitle" style="color:${orange}">${subtitle}</div>`
    : '';
  const textBlock =
    nameBlock || tagBlock || lines.length
      ? `<div class="flare-seller-text">${nameBlock}${tagBlock}${lines.length ? `<div class="flare-seller-lines">${lines.join('')}</div>` : ''}</div>`
      : '';

  if (!logo && !textBlock) return '';
  return `<div class="flare-brand-bar">${logo}${textBlock}</div>`;
}

function buildFlareDescriptionCell(
  config: TemplateConfig,
  item: TemplateRenderInvoiceData['lineItems'][number],
  currency: string
): string {
  const rich = usesRichLineProductCell(config);
  if (rich && item.descriptionHtml) {
    return `<td class="line-product flare-desc" data-col="description">${item.descriptionHtml}</td>`;
  }
  const unitLine =
    !config.sections.lineItems.columns.unitPrice &&
    item.unitPrice &&
    item.unitPrice.trim()
      ? `<div class="flare-unit-price">Unit price ${item.unitPrice} ${esc(currency)}</div>`
      : '';
  return `<td class="flare-desc" data-col="description"><div class="flare-desc-title">${esc(item.description)}</div>${unitLine}</td>`;
}

function buildFlareColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'quantity', weight: 8 },
      { key: 'description', weight: 38 },
      { key: 'sku', weight: 10 },
      { key: 'unitPrice', weight: 12 },
      { key: 'vatRate', weight: 10 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 15 },
    ])
  );
}

function buildFlareHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  if (cols.description) headers.push(lineTableTh('Description', mode));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.unitPrice) headers.push(lineTableTh('Price', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildFlareRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  const cur = esc(data.currency);
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.description) cells.push(buildFlareDescriptionCell(config, item, cur));
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num flare-amount">${item.unitPrice} ${cur}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num flare-amount">${item.lineTotal} ${cur}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildFlareTotalsPanel(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const sumRows: string[] = [];
  if (t.showSubtotal) {
    sumRows.push(
      `<div class="flare-sum-row"><span>${label(config, 'subtotal', 'Subtotal')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount) {
    sumRows.push(
      `<div class="flare-sum-row"><span>${label(config, 'discount', 'Discount')}</span><span>${isZeroMoney(data.totals.discount) ? '—' : `${data.totals.discount} ${cur}`}</span></div>`
    );
  }
  if (t.showVat) {
    sumRows.push(
      `<div class="flare-sum-row"><span>${label(config, 'vatTotal', 'VAT Total')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    sumRows.push(
      `<div class="flare-sum-row"><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  const grand =
    t.showGrandTotal
      ? `<div class="flare-grand">
          <span class="flare-grand-label">${label(config, 'grandTotal', 'Total')}</span>
          <span class="flare-grand-amount"><span class="flare-grand-cur">${cur}</span>${data.totals.grandTotal}</span>
        </div>`
      : '';
  if (!sumRows.length && !grand) return '';
  return `<div class="flare-totals">${sumRows.length ? `<div class="flare-sum-box">${sumRows.join('')}</div>` : ''}${grand}</div>`;
}

function flareStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const orange = branding.primaryColor || '#F97316';
  return `
    .layout-flare {
      margin: -10mm;
      padding: 10mm;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-flare .flare-sheet { min-height: 245mm; }
    .layout-flare .flare-brand-bar {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #E5E7EB;
    }
    .layout-flare .flare-brand-bar .logo-wrap { margin: 0; flex-shrink: 0; }
    .layout-flare .flare-brand-bar .logo { max-height: 48px; max-width: 160px; margin: 0; }
    .layout-flare .flare-seller-name {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 4}px;
      margin: 0 0 4px;
      color: #111827;
      line-height: 1.2;
    }
    .layout-flare .flare-seller-tag {
      font-weight: 600;
      font-size: ${typography.baseFontSize}px;
      margin: 0 0 6px;
      line-height: 1.35;
    }
    .layout-flare .flare-seller-tag p { margin: 0; }
    .layout-flare .flare-seller-lines { color: #374151; line-height: 1.55; font-size: ${typography.baseFontSize}px; }
    .layout-flare .flare-seller-lines p { margin: 0 0 3px; }
    .layout-flare .flare-top {
      display: grid;
      grid-template-columns: minmax(120px, 22%) 1fr 1.1fr;
      gap: 20px;
      align-items: start;
      margin-bottom: 24px;
    }
    .layout-flare .flare-badge {
      background: ${orange};
      color: #fff;
      padding: 18px 16px;
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .layout-flare .flare-badge .document-title {
      margin: 0;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      color: #fff !important;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .layout-flare .flare-badge .document-title p { margin: 0; color: #fff; }
    .layout-flare .flare-meta { line-height: 1.65; color: #374151; padding-top: 4px; }
    .layout-flare .flare-meta p { margin: 0 0 4px; }
    .layout-flare .flare-meta-label { color: #6B7280; font-weight: 500; }
    .layout-flare .flare-meta strong { color: #111827; font-weight: 700; }
    .layout-flare .flare-to { text-align: right; padding-top: 4px; }
    .layout-flare .flare-to-head { font-weight: 700; margin: 0 0 6px; color: #111827; }
    .layout-flare .flare-to-lines { color: #6B7280; line-height: 1.55; }
    .layout-flare .flare-to-lines p { margin: 0 0 3px; }
    .layout-flare .flare-table-wrap { overflow: visible; margin-bottom: 0; }
    ${uniformGridTableBorderCss('.layout-flare table.flare-grid')}
    .layout-flare table.flare-grid thead th {
      background: #F3F4F6;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      padding: 10px 8px;
      text-align: left;
      color: #111827;
    }
    .layout-flare table.flare-grid thead th.num,
    .layout-flare table.flare-grid thead th.qty { text-align: center; }
    .layout-flare table.flare-grid tbody td.qty { text-align: center; font-weight: 500; }
    .layout-flare table.flare-grid tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .layout-flare .flare-desc-title { font-weight: 600; margin: 0 0 4px; }
    .layout-flare .flare-unit-price { color: #9CA3AF; font-size: ${Math.max(typography.labelFontSize, 10)}px; line-height: 1.4; }
    .layout-flare td.line-product { min-width: 0; }
    .layout-flare .line-product-row { gap: 10px; }
    .layout-flare .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    ${layoutTableDensityCss('layout-flare', 'flare', typography, 'flare-grid')}
    .layout-flare table.flare-grid thead th.num,
    .layout-flare table.flare-grid thead th.qty { white-space: nowrap; }
    .layout-flare .flare-totals {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      margin: 0 0 28px;
      max-width: 280px;
      margin-left: auto;
    }
    .layout-flare .flare-sum-box {
      width: 100%;
      background: #F3F4F6;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .layout-flare .flare-sum-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 4px 0;
      font-size: ${typography.baseFontSize}px;
      color: #374151;
    }
    .layout-flare .flare-sum-row span:last-child { font-weight: 600; color: #111827; font-variant-numeric: tabular-nums; }
    .layout-flare .flare-grand {
      display: flex;
      align-items: baseline;
      gap: 14px;
      padding-right: 4px;
    }
    .layout-flare .flare-grand-label { font-weight: 800; font-size: ${typography.baseFontSize + 2}px; color: #111827; }
    .layout-flare .flare-grand-amount {
      font-weight: 800;
      font-size: ${typography.headingFontSize + 6}px;
      color: ${orange};
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .layout-flare .flare-grand-cur {
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      font-weight: 700;
      vertical-align: super;
      margin-right: 4px;
    }
    .layout-flare .flare-mid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
      margin-bottom: 24px;
    }
    .layout-flare .flare-mid.flare-mid-single { grid-template-columns: 1fr; }
    .layout-flare .flare-thanks-side {
      color: ${orange};
      opacity: 0.85;
      font-size: ${typography.baseFontSize}px;
      line-height: 1.55;
    }
    .layout-flare .flare-thanks-side p { margin: 0; }
    .layout-flare .flare-pay-kicker {
      font-weight: 800;
      margin: 0 0 8px;
      color: #111827;
      text-align: right;
    }
    .layout-flare .flare-pay-info {
      text-align: right;
      color: #374151;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-flare .flare-pay-info .social-links { justify-content: flex-end; margin: 0; }
    .layout-flare .flare-page-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: #F3F4F6;
      padding: 14px 10mm;
      margin: 0 -10mm -10mm;
    }
    .layout-flare .flare-foot-left { min-width: 0; flex: 1; }
    .layout-flare .flare-foot-thanks {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 2}px;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-flare .flare-foot-contact { color: #374151; font-size: ${typography.baseFontSize}px; }
    .layout-flare .flare-foot-contact a { color: inherit; text-decoration: underline; }
    .layout-flare .flare-foot-contact .social-links { justify-content: flex-start; margin: 0; }
    .layout-flare .flare-foot-qr { flex-shrink: 0; }
    .layout-flare .flare-foot-qr .verification-qr { margin: 0; }
    .layout-flare .flare-qr-wrap {
      background: ${orange};
      padding: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .layout-flare .flare-qr-wrap img { display: block; background: #fff; }
    [dir="rtl"] .layout-flare .flare-to { text-align: left; }
    [dir="rtl"] .layout-flare .flare-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-flare .flare-pay-kicker,
    [dir="rtl"] .layout-flare .flare-pay-info { text-align: left; }
    [dir="rtl"] .layout-flare .flare-pay-info .social-links { justify-content: flex-start; }
  `;
}

function wrapFlareQr(html: string): string {
  if (!html.trim()) return '';
  return `<div class="flare-foot-qr"><div class="flare-qr-wrap">${html.replace('class="verification-qr"', 'class="verification-qr flare-qr"')}</div></div>`;
}

function renderFlareLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('flare', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="flare-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="flare-grid">${buildFlareColgroup(config)}<thead><tr>${buildFlareHeaders(config, density.mode)}</tr></thead><tbody>${buildFlareRows(config, data)}</tbody></table></div>`
    : '';
  const totalsPanel = showPrices ? buildFlareTotalsPanel(config, data) : '';

  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const flareSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const qrHtml = buildVerificationBlock(config, data);

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const toLines: string[] = [];
  if (buyerVisible) {
    if (bf.address && hasText(data.buyer.addressLine)) toLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) toLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) toLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const metaLines: string[] = [];
  if (hasText(data.invoiceNumber)) {
    metaLines.push(
      `<p><span class="flare-meta-label">${label(config, 'invoiceNumber', 'Invoice No')}</span> <strong>${esc(data.invoiceNumber)}</strong></p>`
    );
  }
  if (hasText(data.issueDate)) {
    metaLines.push(
      `<p><span class="flare-meta-label">${label(config, 'issueDate', 'Date')}</span> <strong>${esc(data.issueDate)}</strong></p>`
    );
  }

  const toHead =
    buyerVisible && bf.name && hasText(data.buyer.name)
      ? `<div class="flare-to-head">${label(config, 'buyer', 'To')}: ${esc(data.buyer.name)}</div>`
      : '';

  const midLeft = richTextHasContent(thanks) ? `<div class="flare-thanks-side">${thanks}</div>` : '';
  const midRight = flareSocial
    ? `<div class="flare-pay">
        <div class="flare-pay-kicker">Payment info</div>
        <div class="flare-pay-info">${flareSocial}</div>
      </div>`
    : '';
  const midSection =
    midLeft || midRight
      ? `<div class="flare-mid${!midLeft || !midRight ? ' flare-mid-single' : ''}">${midLeft}${midRight}</div>`
      : '';

  const pageFoot = `<div class="flare-page-foot">
    <div class="flare-foot-left">
      <div class="flare-foot-thanks">Thank you!</div>
      ${flareSocial ? `<div class="flare-foot-contact">${flareSocial}</div>` : ''}
    </div>
    ${wrapFlareQr(qrHtml)}
  </div>`;

  return `
    <div class="layout-flare">
      <div class="flare-sheet">
        ${buildFlareSellerSection(config, data)}
        <div class="flare-top">
          <div class="flare-badge">${title || '<div class="document-title"><p>Invoice</p></div>'}</div>
          <div class="flare-meta">${metaLines.join('')}</div>
          ${
            toHead || toLines.length
              ? `<div class="flare-to">${toHead}${toLines.length ? `<div class="flare-to-lines">${toLines.join('')}</div>` : ''}</div>`
              : '<div></div>'
          }
        </div>
        ${tableSection}
        ${totalsPanel}
        ${buildOrderNote(config, data)}
        ${midSection}
      </div>
      ${pageFoot}
    </div>`;
}

function buildVaultDescriptionCell(
  config: TemplateConfig,
  item: TemplateRenderInvoiceData['lineItems'][number],
  currency: string
): string {
  const rich = usesRichLineProductCell(config);
  if (rich && item.descriptionHtml) {
    return `<td class="line-product vault-desc" data-col="description">${item.descriptionHtml}</td>`;
  }
  const unitLine =
    !config.sections.lineItems.columns.unitPrice &&
    item.unitPrice &&
    item.unitPrice.trim()
      ? `<div class="vault-unit-price">Unit price ${item.unitPrice} ${esc(currency)}</div>`
      : '';
  return `<td class="vault-desc" data-col="description"><div class="vault-desc-title">${esc(item.description)}</div>${unitLine}</td>`;
}

function buildVaultColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 40 },
      { key: 'quantity', weight: 8 },
      { key: 'sku', weight: 10 },
      { key: 'unitPrice', weight: 11 },
      { key: 'vatRate', weight: 10 },
      { key: 'discount', weight: 11 },
      { key: 'lineTotal', weight: 15 },
    ])
  );
}

function buildVaultHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Description', mode));
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  if (cols.unitPrice) headers.push(lineTableTh('Price', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildVaultRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  const cur = esc(data.currency);
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildVaultDescriptionCell(config, item, cur));
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice} ${cur}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal} ${cur}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildVaultTotalsPanel(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const sumRows: string[] = [];
  if (t.showSubtotal) {
    sumRows.push(
      `<div class="vault-sum-row"><span>${label(config, 'subtotal', 'Subtotal')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount) {
    sumRows.push(
      `<div class="vault-sum-row"><span>${label(config, 'discount', 'Discount')}</span><span>${isZeroMoney(data.totals.discount) ? '—' : `${data.totals.discount} ${cur}`}</span></div>`
    );
  }
  if (t.showVat) {
    sumRows.push(
      `<div class="vault-sum-row"><span>${label(config, 'vatTotal', 'VAT Total')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    sumRows.push(
      `<div class="vault-sum-row"><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  const grand =
    t.showGrandTotal
      ? `<div class="vault-grand">
          <span class="vault-grand-label">${label(config, 'grandTotal', 'Total')}</span>
          <span class="vault-grand-amount"><span class="vault-grand-cur">${cur}</span>${data.totals.grandTotal}</span>
        </div>`
      : '';
  if (!sumRows.length && !grand) return '';
  return `<div class="vault-totals">${sumRows.length ? `<div class="vault-sum-box">${sumRows.join('')}</div>` : ''}${grand}</div>`;
}

function vaultStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const orange = branding.primaryColor || '#F97316';
  const rail = branding.accentColor || '#111111';
  return `
    .layout-vault {
      margin: -10mm;
      padding: 0;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-vault .vault-frame {
      display: grid;
      grid-template-columns: minmax(148px, 30%) 1fr;
      min-height: calc(100% + 20mm);
    }
    .layout-vault .vault-sidebar {
      background: ${rail};
      color: #fff;
      padding: 28px 22px 24px;
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-vault .vault-sidebar-title .document-title {
      margin: 0 0 18px;
      font-size: ${typography.headingFontSize + 4}px;
      font-weight: 800;
      color: #fff !important;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .layout-vault .vault-sidebar-title .document-title p { margin: 0; color: #fff; }
    .layout-vault .vault-sidebar-meta { line-height: 1.65; margin-bottom: 4px; }
    .layout-vault .vault-sidebar-meta p { margin: 0 0 4px; color: rgba(255,255,255,0.92); }
    .layout-vault .vault-sidebar-meta .label { color: rgba(255,255,255,0.72); font-size: ${Math.max(typography.labelFontSize, 10)}px; }
    .layout-vault .vault-sidebar-meta .value { font-weight: 700; display: block; margin-top: 2px; }
    .layout-vault .vault-rule {
      height: 2px;
      background: ${orange};
      margin: 16px 0;
      opacity: 0.95;
    }
    .layout-vault .vault-sidebar-kicker {
      color: rgba(255,255,255,0.72);
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      margin: 0 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .layout-vault .vault-sidebar-name { font-weight: 700; margin: 0 0 6px; }
    .layout-vault .vault-sidebar-lines { color: rgba(255,255,255,0.88); line-height: 1.55; font-size: ${typography.baseFontSize}px; }
    .layout-vault .vault-sidebar-lines p { margin: 0 0 3px; }
    .layout-vault .vault-sidebar-field { margin-bottom: 14px; }
    .layout-vault .vault-sidebar-field .value { font-weight: 700; color: #fff; font-size: ${typography.baseFontSize}px; }
    .layout-vault .vault-sidebar-logo {
      margin-top: auto;
      padding-top: 24px;
    }
    .layout-vault .vault-sidebar-logo .logo-wrap {
      background: #fff;
      padding: 10px;
      display: inline-block;
      margin: 0;
    }
    .layout-vault .vault-sidebar-logo .logo {
      max-height: 40px;
      max-width: 120px;
      margin: 0;
      display: block;
    }
    .layout-vault .vault-body {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      min-width: 0;
    }
    .layout-vault .vault-main {
      flex: 1;
      padding: 28px 10mm 20px;
      min-width: 0;
    }
    .layout-vault .vault-brand {
      text-align: right;
      margin-bottom: 22px;
    }
    .layout-vault .vault-brand-name {
      font-weight: 800;
      font-size: ${typography.headingFontSize - 4}px;
      margin: 0 0 4px;
      color: #111827;
      line-height: 1.15;
    }
    .layout-vault .vault-brand-tag {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 1}px;
      line-height: 1.35;
    }
    .layout-vault .vault-brand-tag p { margin: 0; }
    .layout-vault .vault-brand-meta {
      margin-top: 6px;
      color: #6B7280;
      line-height: 1.5;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-vault .vault-brand-meta p { margin: 0 0 2px; }
    .layout-vault .vault-table-wrap { overflow: visible; margin-bottom: 0; }
    ${uniformGridTableBorderCss('.layout-vault table.vault-grid')}
    .layout-vault table.vault-grid thead th {
      background: #F3F4F6;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      padding: 10px 8px;
      text-align: left;
      color: #111827;
    }
    .layout-vault table.vault-grid tbody td {
      padding: 10px 8px;
    }
    .layout-vault table.vault-grid thead th.num,
    .layout-vault table.vault-grid thead th.qty { text-align: center; white-space: nowrap; }
    .layout-vault table.vault-grid tbody td.qty { text-align: center; font-weight: 500; }
    .layout-vault table.vault-grid tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .layout-vault .vault-desc-title { font-weight: 600; margin: 0 0 4px; }
    .layout-vault .vault-unit-price { color: #9CA3AF; font-size: ${Math.max(typography.labelFontSize, 10)}px; }
    .layout-vault td.line-product { min-width: 0; }
    .layout-vault .line-product-row { gap: 10px; }
    .layout-vault .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    ${layoutTableDensityCss('layout-vault', 'vault', typography, 'vault-grid')}
    .layout-vault .vault-table-compact .vault-desc-title { margin: 0 0 2px; }
    .layout-vault .vault-table-compact .vault-unit-price { font-size: ${Math.max(typography.labelFontSize - 1, 9)}px; }
    .layout-vault .vault-totals {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      margin: 0 0 24px;
      max-width: 280px;
      margin-left: auto;
    }
    .layout-vault .vault-sum-box {
      width: 100%;
      background: #F3F4F6;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .layout-vault .vault-sum-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 4px 0;
      font-size: ${typography.baseFontSize}px;
      color: #374151;
    }
    .layout-vault .vault-sum-row span:last-child { font-weight: 600; color: #111827; font-variant-numeric: tabular-nums; }
    .layout-vault .vault-grand {
      display: flex;
      align-items: baseline;
      gap: 14px;
      padding-right: 4px;
    }
    .layout-vault .vault-grand-label { font-weight: 800; font-size: ${typography.baseFontSize + 2}px; color: #111827; }
    .layout-vault .vault-grand-amount {
      font-weight: 800;
      font-size: ${typography.headingFontSize + 6}px;
      color: ${orange};
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .layout-vault .vault-grand-cur {
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      font-weight: 700;
      vertical-align: super;
      margin-right: 4px;
    }
    .layout-vault .vault-terms-block { margin-bottom: 20px; max-width: 420px; }
    .layout-vault .vault-terms-kicker {
      color: ${orange};
      font-weight: 800;
      margin: 0 0 8px;
    }
    .layout-vault .vault-terms-body,
    .layout-vault .vault-thanks-main {
      color: #6B7280;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-vault .vault-terms-body p,
    .layout-vault .vault-thanks-main p { margin: 0 0 4px; }
    .layout-vault .vault-page-foot {
      background: #F3F4F6;
      padding: 16px 10mm;
      margin-top: auto;
    }
    .layout-vault .vault-foot-thanks {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 2}px;
      margin: 0 0 8px;
      color: #111827;
    }
    .layout-vault .vault-foot-contact { color: #374151; font-size: ${typography.baseFontSize}px; }
    .layout-vault .vault-foot-contact a { color: inherit; text-decoration: underline; }
    .layout-vault .vault-foot-contact .social-links { justify-content: flex-start; margin: 0; }
    .layout-vault .verification-qr { margin-top: 16px; }
    [dir="rtl"] .layout-vault .vault-frame { direction: rtl; }
    [dir="rtl"] .layout-vault .vault-brand { text-align: left; }
    [dir="rtl"] .layout-vault .vault-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-vault .vault-grand { justify-content: flex-start; }
  `;
}

function renderVaultLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('vault', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="vault-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="vault-grid">${buildVaultColgroup(config)}<thead><tr>${buildVaultHeaders(config, density.mode)}</tr></thead><tbody>${buildVaultRows(config, data)}</tbody></table></div>`
    : '';
  const totalsPanel = showPrices ? buildVaultTotalsPanel(config, data) : '';

  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const vaultSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const sf = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const orange = config.branding.primaryColor || '#F97316';
  const subtitle = docSubtitle(config);
  const brandMeta: string[] = [];
  if (sellerVisible) {
    if (sf.trn && hasText(data.seller.trn)) brandMeta.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
    if (sf.address && hasText(data.seller.address.line1)) brandMeta.push(`<p>${esc(data.seller.address.line1)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) brandMeta.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  }

  const brandBlock =
    sellerVisible && (sf.legalName && hasText(data.seller.legalName)) || subtitle || brandMeta.length
      ? `<div class="vault-brand">
          ${sellerVisible && sf.legalName && hasText(data.seller.legalName) ? `<div class="vault-brand-name">${esc(data.seller.legalName)}</div>` : ''}
          ${subtitle ? `<div class="vault-brand-tag document-subtitle" style="color:${orange}">${subtitle}</div>` : ''}
          ${brandMeta.length ? `<div class="vault-brand-meta">${brandMeta.join('')}</div>` : ''}
        </div>`
      : '';

  const bf = config.sections.buyer.fields;
  const buyerVisible = config.sections.buyer.visible;
  const toLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) toLines.push(`<div class="vault-sidebar-name">${esc(data.buyer.name)}</div>`);
    if (bf.address && hasText(data.buyer.addressLine)) toLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
    if (bf.phone && hasText(data.buyer.phone)) toLines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
    if (bf.email && hasText(data.buyer.email)) toLines.push(`<p>${esc(data.buyer.email)}</p>`);
  }

  const sidebarMeta: string[] = [];
  if (hasText(data.invoiceNumber)) {
    sidebarMeta.push(
      `<p><span class="label">${label(config, 'invoiceNumber', 'Invoice No')}</span><span class="value">${esc(data.invoiceNumber)}</span></p>`
    );
  }
  if (hasText(data.issueDate)) {
    sidebarMeta.push(
      `<p><span class="label">${label(config, 'issueDate', 'Date')}</span><span class="value">${esc(data.issueDate)}</span></p>`
    );
  }

  const accountField =
    sellerVisible && sf.legalName && hasText(data.seller.legalName)
      ? `<div class="vault-sidebar-field">
          <div class="vault-sidebar-kicker">Account name</div>
          <div class="value">${esc(data.seller.legalName)}</div>
        </div>`
      : '';

  const logo = buildLogo(config);
  const sidebarLogo = logo ? `<div class="vault-sidebar-logo">${logo}</div>` : '';

  const termsBlock = showPay
    ? `<div class="vault-terms-block">
        <div class="vault-terms-kicker">Terms &amp; Condition</div>
        <div class="vault-terms-body">${terms}</div>
      </div>`
    : richTextHasContent(thanks)
      ? `<div class="vault-thanks-main">${thanks}</div>`
      : '';

  const pageFoot = `<div class="vault-page-foot">
    <div class="vault-foot-thanks">Thank you!</div>
    ${vaultSocial ? `<div class="vault-foot-contact">${vaultSocial}</div>` : ''}
  </div>`;

  return `
    <div class="layout-vault">
      <div class="vault-frame">
        <aside class="vault-sidebar">
          <div class="vault-sidebar-title">${title || '<div class="document-title"><p>Invoice</p></div>'}</div>
          ${sidebarMeta.length ? `<div class="vault-sidebar-meta">${sidebarMeta.join('')}</div>` : ''}
          ${toLines.length ? `<div class="vault-rule"></div><div class="vault-sidebar-kicker">${label(config, 'buyer', 'To')}</div><div class="vault-sidebar-lines">${toLines.join('')}</div>` : ''}
          ${accountField ? `<div class="vault-rule"></div>${accountField}` : ''}
          ${sidebarLogo}
        </aside>
        <div class="vault-body">
          <main class="vault-main">
            ${brandBlock}
            ${tableSection}
            ${totalsPanel}
            ${buildOrderNote(config, data)}
            ${buildVerificationBlock(config, data)}
            ${termsBlock}
          </main>
          ${pageFoot}
        </div>
      </div>
    </div>`;
}

function buildBeaconMoneyCell(value: string, currency: string, className: string): string {
  return `<td class="${className} beacon-num beacon-money"><span class="beacon-cur">${esc(currency)}</span><span class="beacon-amt">${value}</span></td>`;
}

function buildBeaconColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 38 },
      { key: 'unitPrice', weight: 12 },
      { key: 'quantity', weight: 10 },
      { key: 'sku', weight: 9 },
      { key: 'vatRate', weight: 9 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 14 },
    ])
  );
}

function buildBeaconHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(lineTableTh('Description', mode));
  if (cols.unitPrice) headers.push(lineTableTh('Price', mode, 'num'));
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Amount', mode, 'num'));
  return headers.join('');
}

function buildBeaconDescriptionCell(
  config: TemplateConfig,
  item: TemplateRenderInvoiceData['lineItems'][number]
): string {
  const rich = usesRichLineProductCell(config);
  if (rich && item.descriptionHtml) {
    return `<td class="line-product beacon-desc" data-col="description">${item.descriptionHtml}</td>`;
  }
  return `<td class="beacon-desc" data-col="description"><div class="beacon-desc-title">${esc(item.description)}</div></td>`;
}

function buildBeaconRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  const cur = esc(data.currency);
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildBeaconDescriptionCell(config, item));
      if (cols.unitPrice) cells.push(buildBeaconMoneyCell(item.unitPrice, cur, 'num'));
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(buildBeaconMoneyCell(item.lineTotal, cur, 'num'));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildBeaconTotalsPanel(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const orange = config.branding.primaryColor || '#F97316';
  const sumRows: string[] = [];
  if (t.showSubtotal) {
    sumRows.push(
      `<div class="beacon-sum-row"><span>${label(config, 'subtotal', 'Subtotal')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount) {
    sumRows.push(
      `<div class="beacon-sum-row"><span>${label(config, 'discount', 'Discount')}</span><span>${isZeroMoney(data.totals.discount) ? '—' : `${data.totals.discount} ${cur}`}</span></div>`
    );
  }
  if (t.showVat) {
    sumRows.push(
      `<div class="beacon-sum-row"><span>${label(config, 'vatTotal', 'VAT Total')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    sumRows.push(
      `<div class="beacon-sum-row"><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  const grand =
    t.showGrandTotal
      ? `<div class="beacon-grand">
          <span class="beacon-grand-label">${label(config, 'grandTotal', 'Total')}</span>
          <span class="beacon-grand-amount" style="color:${orange}"><span class="beacon-grand-cur">${cur}</span>${data.totals.grandTotal}</span>
        </div>`
      : '';
  if (!sumRows.length && !grand) return '';
  return `<div class="beacon-totals">${sumRows.length ? sumRows.join('') : ''}${grand}</div>`;
}

function buildBeaconBrandBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const sf = config.sections.seller.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const orange = config.branding.primaryColor || '#F97316';
  const subtitle = docSubtitle(config);
  const logo = buildLogo(config);
  const name =
    sellerVisible && sf.legalName && hasText(data.seller.legalName)
      ? `<div class="beacon-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const tag = subtitle ? `<div class="beacon-brand-tag document-subtitle" style="color:${orange}">${subtitle}</div>` : '';
  if (!logo && !name && !tag) return '';
  return `<div class="beacon-brand">${logo}${name}${tag}</div>`;
}

function buildBeaconFromBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (config.sections.seller.visible === false) return '';
  const sf = config.sections.seller.fields;
  const lines: string[] = [];
  if (sf.legalName && hasText(data.seller.legalName)) {
    lines.push(`<div class="beacon-party-name">${esc(data.seller.legalName)}</div>`);
  }
  if (sf.address && hasText(data.seller.address.line1)) lines.push(`<p>${esc(data.seller.address.line1)}</p>`);
  if (sf.emirate && hasText(data.seller.address.emirate)) lines.push(`<p>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</p>`);
  if (sf.trn && hasText(data.seller.trn)) {
    lines.push(`<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`);
  }
  if (lines.length === 0) return '';
  return `<div class="beacon-from">${lines.join('')}</div>`;
}

function buildBeaconToBlock(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.buyer.visible) return '';
  const bf = config.sections.buyer.fields;
  const lines: string[] = [];
  if (bf.name && hasText(data.buyer.name)) lines.push(`<div class="beacon-party-name">${esc(data.buyer.name)}</div>`);
  if (bf.address && hasText(data.buyer.addressLine)) lines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  if (bf.phone && hasText(data.buyer.phone)) lines.push(`<p>${esc(data.buyer.phone ?? '')}</p>`);
  if (bf.email && hasText(data.buyer.email)) lines.push(`<p>${esc(data.buyer.email)}</p>`);
  if (lines.length === 0) return '';
  return `<div class="beacon-to">${lines.join('')}</div>`;
}

function buildBeaconInfoBox(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const terms = richBlock(config, config.content.terms.html, '');
  const showPay =
    config.content.showTerms !== false && richTextHasContent(config.content.terms.html);
  const showNotes =
    config.content.showNotes !== false && richTextHasContent(config.content.customNote.html);
  const beaconSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const payParts: string[] = [];
  if (showNotes) payParts.push(`<div>${rich(config.content.customNote.html)}</div>`);
  if (beaconSocial) payParts.push(beaconSocial);
  if (!showNotes && payParts.length === 0) {
    const fromFallback = buildBeaconFromBlock(config, data);
    if (fromFallback) payParts.push(fromFallback);
  }

  const payCol =
    payParts.length > 0
      ? `<div class="beacon-info-col beacon-pay">
          <div class="beacon-info-kicker">Payment</div>
          <div class="beacon-info-body">${payParts.join('')}</div>
        </div>`
      : '';

  const termsCol = showPay
    ? `<div class="beacon-info-col beacon-terms">
        <div class="beacon-info-kicker">Terms &amp; Condition</div>
        <div class="beacon-info-body">${terms}</div>
      </div>`
    : '';

  if (!payCol && !termsCol) return '';
  return `<div class="beacon-info-box${!payCol || !termsCol ? ' beacon-info-single' : ''}">${payCol}${termsCol}</div>`;
}

function beaconStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const orange = branding.primaryColor || '#F97316';
  return `
    .layout-beacon {
      margin: -10mm;
      padding: 10mm;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-beacon .beacon-sheet { min-height: 245mm; }
    .layout-beacon .beacon-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .layout-beacon .beacon-header-left { min-width: 0; }
    .layout-beacon .beacon-title .document-title {
      margin: 0 0 8px;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .layout-beacon .beacon-title .document-title p { margin: 0; }
    .layout-beacon .beacon-ids {
      color: #6B7280;
      font-size: ${typography.baseFontSize}px;
      line-height: 1.5;
    }
    .layout-beacon .beacon-brand {
      text-align: right;
      max-width: 46%;
      margin-left: auto;
    }
    .layout-beacon .beacon-brand .logo-wrap { margin: 0 0 8px auto; }
    .layout-beacon .beacon-brand .logo { max-height: 48px; max-width: 180px; margin: 0 0 0 auto; }
    .layout-beacon .beacon-brand-name {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 3}px;
      line-height: 1.2;
      margin: 0 0 4px;
      color: #111827;
    }
    .layout-beacon .beacon-brand-tag {
      font-weight: 600;
      font-size: ${typography.baseFontSize}px;
      line-height: 1.35;
    }
    .layout-beacon .beacon-brand-tag p { margin: 0; }
    .layout-beacon .beacon-parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
      align-items: start;
    }
    .layout-beacon .beacon-party-name {
      font-weight: 700;
      margin: 0 0 6px;
      color: #111827;
    }
    .layout-beacon .beacon-from,
    .layout-beacon .beacon-to {
      color: #6B7280;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-beacon .beacon-from p,
    .layout-beacon .beacon-to p { margin: 0 0 3px; }
    .layout-beacon .beacon-to { text-align: right; }
    .layout-beacon .beacon-table-wrap { overflow: visible; margin-bottom: 0; }
    ${uniformGridTableBorderCss('.layout-beacon table.beacon-grid')}
    .layout-beacon table.beacon-grid thead th {
      background: #F3F4F6;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      padding: 10px 8px;
      text-align: left;
      color: #111827;
    }
    .layout-beacon table.beacon-grid thead th.num,
    .layout-beacon table.beacon-grid thead th.qty { text-align: center; white-space: nowrap; }
    .layout-beacon table.beacon-grid tbody td { padding: 12px 8px; }
    .layout-beacon table.beacon-grid tbody td.qty { text-align: center; font-weight: 500; }
    .layout-beacon table.beacon-grid tbody td.num { text-align: center; font-variant-numeric: tabular-nums; }
    .layout-beacon .beacon-money { text-align: center; vertical-align: middle; }
    .layout-beacon .beacon-money .beacon-cur {
      display: block;
      font-size: ${Math.max(typography.labelFontSize - 1, 9)}px;
      color: #6B7280;
      line-height: 1.2;
      margin-bottom: 2px;
    }
    .layout-beacon .beacon-money .beacon-amt { display: block; font-weight: 500; }
    .layout-beacon .beacon-desc-title { font-weight: 600; margin: 0; }
    .layout-beacon td.line-product { min-width: 0; }
    .layout-beacon .line-product-row { gap: 10px; }
    .layout-beacon .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    ${layoutTableDensityCss('layout-beacon', 'beacon', typography, 'beacon-grid')}
    .layout-beacon .beacon-totals {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      margin: 16px 0 28px;
      max-width: 280px;
      margin-left: auto;
      gap: 6px;
    }
    .layout-beacon .beacon-sum-row {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      width: 100%;
      color: #6B7280;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-beacon .beacon-sum-row span:last-child { color: #111827; font-variant-numeric: tabular-nums; }
    .layout-beacon .beacon-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 24px;
      width: 100%;
      margin-top: 8px;
      padding-top: 10px;
      border-top: 1px solid #E5E7EB;
    }
    .layout-beacon .beacon-grand-label {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 2}px;
      color: #111827;
    }
    .layout-beacon .beacon-grand-amount {
      font-weight: 800;
      font-size: ${typography.headingFontSize - 4}px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .layout-beacon .beacon-grand-cur {
      font-size: ${Math.max(typography.labelFontSize, 10)}px;
      font-weight: 700;
      margin-right: 4px;
    }
    .layout-beacon .beacon-info-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      background: #F3F4F6;
      padding: 18px 20px;
      margin-bottom: 24px;
    }
    .layout-beacon .beacon-info-box.beacon-info-single { grid-template-columns: 1fr; }
    .layout-beacon .beacon-info-kicker {
      font-weight: 800;
      margin: 0 0 8px;
      color: ${orange};
      font-size: ${typography.baseFontSize}px;
    }
    .layout-beacon .beacon-info-body {
      color: #374151;
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-beacon .beacon-info-body p { margin: 0 0 4px; }
    .layout-beacon .beacon-info-body .social-links { margin: 0; }
    .layout-beacon .beacon-page-foot {
      background: #F3F4F6;
      padding: 16px 10mm;
      margin: 0 -10mm -10mm;
    }
    .layout-beacon .beacon-foot-thanks {
      font-weight: 700;
      font-size: ${typography.baseFontSize + 3}px;
      margin: 0 0 10px;
      color: #111827;
    }
    .layout-beacon .beacon-foot-contact {
      color: #374151;
      font-size: ${typography.baseFontSize}px;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .layout-beacon .beacon-foot-contact .social-links { justify-content: flex-start; margin: 0; }
    .layout-beacon .beacon-foot-contact a { color: inherit; text-decoration: inherit; }
    .layout-beacon .verification-qr { margin-top: 16px; }
    [dir="rtl"] .layout-beacon .beacon-brand { text-align: left; margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-beacon .beacon-brand .logo { margin: 0 auto 0 0; }
    [dir="rtl"] .layout-beacon .beacon-to { text-align: left; }
    [dir="rtl"] .layout-beacon .beacon-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-beacon .beacon-grand { justify-content: flex-start; }
  `;
}

function renderBeaconLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const title = wrapIf('beacon-title document-title', docTitle(config));
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('beacon', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="beacon-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="beacon-grid">${buildBeaconColgroup(config)}<thead><tr>${buildBeaconHeaders(config, density.mode)}</tr></thead><tbody>${buildBeaconRows(config, data)}</tbody></table></div>`
    : '';
  const totalsPanel = showPrices ? buildBeaconTotalsPanel(config, data) : '';

  const thanks = richBlock(config, config.content.footer.html, config.translations?.footer?.html ?? '');
  const beaconSocial = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });

  const idParts: string[] = [];
  if (hasText(data.invoiceNumber)) idParts.push(esc(data.invoiceNumber));
  if (hasText(data.issueDate)) idParts.push(esc(data.issueDate));
  const idsLine = idParts.length ? `<div class="beacon-ids">${idParts.join('&nbsp;&nbsp;&nbsp;&nbsp;')}</div>` : '';

  const fromBlock = buildBeaconFromBlock(config, data);
  const toBlock = buildBeaconToBlock(config, data);
  const partiesSection =
    fromBlock || toBlock
      ? `<div class="beacon-parties">${fromBlock || '<div></div>'}${toBlock || '<div></div>'}</div>`
      : '';

  const pageFoot =
    richTextHasContent(thanks) || beaconSocial
      ? `<div class="beacon-page-foot">
          ${richTextHasContent(thanks) ? `<div class="beacon-foot-thanks">${thanks}</div>` : '<div class="beacon-foot-thanks">Thank you!</div>'}
          ${beaconSocial ? `<div class="beacon-foot-contact">${beaconSocial}</div>` : ''}
        </div>`
      : '';

  return `
    <div class="layout-beacon">
      <div class="beacon-sheet">
        <div class="beacon-header">
          <div class="beacon-header-left">
            ${title || '<div class="beacon-title document-title"><p>Invoice</p></div>'}
            ${idsLine}
          </div>
          ${buildBeaconBrandBlock(config, data)}
        </div>
        ${partiesSection}
        ${tableSection}
        ${totalsPanel}
        ${buildOrderNote(config, data)}
        ${buildVerificationBlock(config, data)}
        ${buildBeaconInfoBox(config, data)}
      </div>
      ${pageFoot}
    </div>`;
}

function buildOnyxColgroup(config: TemplateConfig): string {
  return buildLayoutColgroup(
    config,
    adaptiveLineTableColumnWeights(config, [
      { key: 'description', weight: 40 },
      { key: 'unitPrice', weight: 12 },
      { key: 'quantity', weight: 10 },
      { key: 'sku', weight: 9 },
      { key: 'vatRate', weight: 9 },
      { key: 'discount', weight: 10 },
      { key: 'lineTotal', weight: 14 },
    ])
  );
}

function buildOnyxHeaders(config: TemplateConfig, mode: LineTableDensityMode = 'comfortable'): string {
  const cols = config.sections.lineItems.columns;
  const headers: string[] = [];
  if (cols.description) headers.push(`<th>Item</th>`);
  if (cols.unitPrice) headers.push(`<th class="num">Cost</th>`);
  if (cols.quantity) headers.push(lineTableTh('Qty', mode, 'qty'));
  if (cols.sku) headers.push(lineTableTh('SKU', mode, 'num'));
  pushLineTableVatHeaders(headers, cols, (label, cls) => lineTableTh(label, mode, cls));
  if (cols.discount !== false) headers.push(lineTableTh('Disc %', mode, 'num'));
  if (cols.lineTotal) headers.push(lineTableTh('Total', mode, 'num'));
  return headers.join('');
}

function buildOnyxDescriptionCell(
  config: TemplateConfig,
  item: TemplateRenderInvoiceData['lineItems'][number]
): string {
  const rich = usesRichLineProductCell(config);
  if (rich && item.descriptionHtml) {
    return `<td class="line-product onyx-item" data-col="description">${item.descriptionHtml}</td>`;
  }
  return `<td class="onyx-item" data-col="description">${esc(item.description)}</td>`;
}

function buildOnyxRows(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  const cols = config.sections.lineItems.columns;
  const cur = esc(data.currency);
  return data.lineItems
    .map((item) => {
      const cells: string[] = [];
      if (cols.description) cells.push(buildOnyxDescriptionCell(config, item));
      if (cols.unitPrice) cells.push(`<td class="num">${item.unitPrice} ${cur}</td>`);
      if (cols.quantity) cells.push(`<td class="qty">${item.quantity}</td>`);
      if (cols.sku) cells.push(`<td class="num">${esc(item.sku ?? '')}</td>`);
      pushLineTableVatCells(cells, cols, item);
      if (cols.discount !== false) cells.push(`<td class="num">${item.discount || '0%'}</td>`);
      if (cols.lineTotal) cells.push(`<td class="num">${item.lineTotal} ${cur}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
}

function buildOnyxMetaCell(kicker: string, bodyHtml: string): string {
  if (!bodyHtml.trim()) return '';
  return `<div class="onyx-meta-cell"><div class="onyx-meta-kicker">${esc(kicker)}</div><div class="onyx-meta-body">${bodyHtml}</div></div>`;
}

function buildOnyxHeaderBlock(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  _documentType: DocumentType
): string {
  const sf = config.sections.seller.fields;
  const bf = config.sections.buyer.fields;
  const sellerVisible = config.sections.seller.visible !== false;
  const buyerVisible = config.sections.buyer.visible;
  const logo = buildLogo(config);
  const brandName =
    sellerVisible && sf.legalName && hasText(data.seller.legalName)
      ? `<div class="onyx-brand-name">${esc(data.seller.legalName)}</div>`
      : '';
  const title = wrapIf('onyx-title document-title', docTitle(config));
  const invRef = hasText(data.invoiceNumber)
    ? `<span class="onyx-inv-ref">#${esc(data.invoiceNumber)}</span>`
    : '';

  const fromLines: string[] = [];
  if (sellerVisible) {
    if (sf.legalName && hasText(data.seller.legalName)) fromLines.push(`<p>${esc(data.seller.legalName)}</p>`);
    if (sf.address && hasText(data.seller.address.line1)) fromLines.push(`<p>${esc(data.seller.address.line1)}</p>`);
    if (sf.emirate && hasText(data.seller.address.emirate)) {
      const regionCountry = formatRegionCountryDisplay(
        data.seller.address.emirate,
        data.seller.address.country
      );
      if (regionCountry) fromLines.push(`<p>${esc(regionCountry)}</p>`);
    } else if (sf.address && hasText(data.seller.address.country)) {
      fromLines.push(`<p>${esc(data.seller.address.country)}</p>`);
    }
  }

  const toLines: string[] = [];
  if (buyerVisible) {
    if (bf.name && hasText(data.buyer.name)) toLines.push(`<p>${esc(data.buyer.name)}</p>`);
    if (bf.address && hasText(data.buyer.addressLine)) toLines.push(`<p>${esc(data.buyer.addressLine ?? '')}</p>`);
  }

  const issueCell = hasText(data.issueDate)
    ? buildOnyxMetaCell(label(config, 'issueDate', 'Issue date'), `<p>${esc(data.issueDate)}</p>`)
    : '';

  const fromCell = buildOnyxMetaCell(label(config, 'seller', 'From'), fromLines.join(''));
  const toCell = buildOnyxMetaCell(label(config, 'buyer', 'To'), toLines.join(''));

  const trnCell =
    sellerVisible && sf.trn && hasText(data.seller.trn)
      ? buildOnyxMetaCell('Company number', `<p>${label(config, 'trn', 'TRN')}: ${esc(data.seller.trn)}</p>`)
      : '';

  const partyRow =
    fromCell || toCell
      ? `<div class="onyx-meta-row onyx-meta-parties">${fromCell || '<div></div>'}${toCell || '<div></div>'}</div>`
      : '';
  const metaRows = [issueCell ? `<div class="onyx-meta-row">${issueCell}</div>` : '', partyRow, trnCell ? `<div class="onyx-meta-row">${trnCell}</div>` : '']
    .filter(Boolean)
    .join('');
  const metaGrid = metaRows ? `<div class="onyx-meta-rows">${metaRows}</div>` : '';

  return `<div class="onyx-header">
    <div class="onyx-header-top">
      <div class="onyx-brand">${logo}${brandName}</div>
      <div class="onyx-title-row">${title || '<div class="onyx-title document-title"><p>Invoice</p></div>'}${invRef}</div>
    </div>
    ${metaGrid}
  </div>`;
}

function buildOnyxTotals(config: TemplateConfig, data: TemplateRenderInvoiceData): string {
  if (!config.sections.totals.visible) return '';
  const t = config.sections.totals;
  const cur = esc(data.currency);
  const rows: string[] = [];
  if (t.showSubtotal) {
    rows.push(
      `<div class="onyx-sum-row"><span>${label(config, 'subtotal', 'Subtotal')}</span><span>${data.totals.subtotal} ${cur}</span></div>`
    );
  }
  if (t.showDiscount) {
    rows.push(
      `<div class="onyx-sum-row"><span>${label(config, 'discount', 'Discount')}</span><span>${isZeroMoney(data.totals.discount) ? '0.00 ' + cur : `${data.totals.discount} ${cur}`}</span></div>`
    );
  }
  if (t.showVat) {
    rows.push(
      `<div class="onyx-sum-row"><span>${label(config, 'vatTotal', 'VAT')}</span><span>${data.totals.vatTotal} ${cur}</span></div>`
    );
  }
  if (t.showShipping && !isZeroMoney(data.totals.shipping)) {
    rows.push(
      `<div class="onyx-sum-row"><span>${label(config, 'shipping', 'Shipping')}</span><span>${data.totals.shipping} ${cur}</span></div>`
    );
  }
  const invoiceTotal =
    t.showGrandTotal
      ? `<div class="onyx-inv-total"><span>${label(config, 'grandTotal', 'Invoice total')}</span><span>${data.totals.grandTotal} ${cur}</span></div>`
      : '';
  const amountDue =
    t.showGrandTotal
      ? `<div class="onyx-amount-due"><span>Amount due</span><strong>${data.totals.grandTotal} ${cur}</strong></div>`
      : '';
  if (!rows.length && !invoiceTotal) return '';
  return `<div class="onyx-totals">${rows.join('')}${invoiceTotal}${amountDue}</div>`;
}

function onyxStyles(config: TemplateConfig): string {
  const { typography, branding } = config;
  const ink = branding.primaryColor || '#111111';
  return `
    .layout-onyx {
      margin: -10mm;
      padding: 0;
      background: #fff;
      color: #111827;
      min-height: calc(100% + 20mm);
    }
    .layout-onyx .onyx-header {
      background: ${ink};
      color: #fff;
      padding: 10mm 10mm 8mm;
      margin-bottom: 0;
    }
    .layout-onyx .onyx-header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 24px;
    }
    .layout-onyx .onyx-brand .logo-wrap { margin: 0 0 8px; }
    .layout-onyx .onyx-brand .logo {
      max-height: 52px;
      max-width: 180px;
      margin: 0;
      filter: brightness(0) invert(1);
    }
    .layout-onyx .onyx-brand-name {
      font-weight: 800;
      font-size: ${typography.baseFontSize + 4}px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.2;
    }
    .layout-onyx .onyx-title-row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
      text-align: right;
    }
    .layout-onyx .onyx-title-row .document-title,
    .layout-onyx .onyx-title-row .onyx-title {
      margin: 0;
      font-size: ${typography.headingFontSize}px;
      font-weight: 800;
      color: #fff !important;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .layout-onyx .onyx-title-row .document-title p { margin: 0; color: #fff; }
    .layout-onyx .onyx-inv-ref {
      font-size: ${Math.max(typography.headingFontSize - 8, 18)}px;
      font-weight: 700;
      color: #fff;
      opacity: 0.92;
    }
    .layout-onyx .onyx-meta-rows {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .layout-onyx .onyx-meta-row.onyx-meta-parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
    }
    .layout-onyx .onyx-meta-kicker {
      font-weight: 800;
      margin: 0 0 6px;
      font-size: ${typography.baseFontSize}px;
      color: #fff;
    }
    .layout-onyx .onyx-meta-body {
      color: rgba(255,255,255,0.88);
      line-height: 1.55;
      font-size: ${typography.baseFontSize}px;
    }
    .layout-onyx .onyx-meta-body p { margin: 0 0 3px; }
    .layout-onyx .onyx-body {
      padding: 8mm 10mm 10mm;
    }
    .layout-onyx .onyx-table-wrap { overflow: visible; margin-bottom: 0; }
    .layout-onyx table.onyx-grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: none;
    }
    .layout-onyx table.onyx-grid th,
    .layout-onyx table.onyx-grid td {
      border: none;
      border-bottom: 1px solid #111827;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
      padding: 10px 4px;
    }
    .layout-onyx table.onyx-grid thead th {
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: ${typography.labelFontSize}px;
      text-align: left;
      color: #111827;
      padding-top: 0;
    }
    .layout-onyx table.onyx-grid thead th.num,
    .layout-onyx table.onyx-grid thead th.qty { text-align: right; white-space: nowrap; }
    .layout-onyx table.onyx-grid tbody td.onyx-item { font-weight: 500; }
    .layout-onyx table.onyx-grid tbody td.qty,
    .layout-onyx table.onyx-grid tbody td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .layout-onyx td.line-product { min-width: 0; }
    .layout-onyx .line-product-row { gap: 10px; }
    .layout-onyx .line-product-thumb-wrap { width: 40px; height: 40px; flex-shrink: 0; }
    ${layoutTableDensityCss('layout-onyx', 'onyx', typography, 'onyx-grid')}
    .layout-onyx .onyx-lower {
      display: flex;
      justify-content: flex-end;
      margin-top: 28px;
    }
    .layout-onyx .onyx-totals {
      width: 100%;
      max-width: 320px;
      margin-left: auto;
    }
    .layout-onyx .onyx-sum-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 4px 0;
      font-size: ${typography.baseFontSize}px;
      color: #374151;
    }
    .layout-onyx .onyx-sum-row span:last-child { font-variant-numeric: tabular-nums; color: #111827; }
    .layout-onyx .onyx-inv-total {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #111827;
      font-weight: 800;
      font-size: ${typography.baseFontSize}px;
      color: #111827;
    }
    .layout-onyx .onyx-amount-due {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 2px solid #111827;
      font-size: ${typography.baseFontSize}px;
      color: #111827;
    }
    .layout-onyx .onyx-amount-due strong {
      font-size: ${typography.baseFontSize + 2}px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .layout-onyx .verification-qr { margin-top: 24px; }
    [dir="rtl"] .layout-onyx .onyx-title-row { justify-content: flex-start; text-align: left; }
    [dir="rtl"] .layout-onyx .onyx-totals { margin-left: 0; margin-right: auto; }
    [dir="rtl"] .layout-onyx table.onyx-grid thead th.num,
    [dir="rtl"] .layout-onyx table.onyx-grid tbody td.num,
    [dir="rtl"] .layout-onyx table.onyx-grid tbody td.qty { text-align: left; }
  `;
}

function renderOnyxLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const showPrices = documentType !== 'packing_slip' && config.sections.totals.visible !== false;
  const density = resolveLineTableDensity(config);
  const densityClass = lineTableDensityWrapClass('onyx', density.mode);
  const tableSection = config.sections.lineItems.visible
    ? `<div class="onyx-table-wrap${densityClass ? ` ${densityClass}` : ''}"><table class="onyx-grid">${buildOnyxColgroup(config)}<thead><tr>${buildOnyxHeaders(config, density.mode)}</tr></thead><tbody>${buildOnyxRows(config, data)}</tbody></table></div>`
    : '';

  const totalsBlock = showPrices ? buildOnyxTotals(config, data) : '';
  const lowerSection = totalsBlock ? `<div class="onyx-lower">${totalsBlock}</div>` : '';

  return `
    <div class="layout-onyx">
      ${buildOnyxHeaderBlock(config, data, documentType)}
      <div class="onyx-body">
        ${tableSection}
        ${buildOrderNote(config, data)}
        ${lowerSection}
        ${buildVerificationBlock(config, data)}
      </div>
    </div>`;
}

function renderModernLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const headerInner = `
    <div class="brand">
      ${buildLogo(config)}
      ${wrapIf('document-title', docTitle(config))}
      ${wrapIf('document-subtitle', docSubtitle(config, documentType === 'packing_slip' ? '' : data.currency))}
    </div>
    <div class="meta">${buildMetaBlock(config, data, documentType)}</div>`;

  const header =
    config.layout.headerStyle === 'banner'
      ? `<div class="banner">${headerInner}</div>`
      : `<div class="top">${headerInner}</div>`;

  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildLineItemHeaders(config)}</tr></thead><tbody>${buildLineItemRows(config, data)}</tbody></table>`
    : '';

  return `
    ${config.layout.headerStyle === 'emirates' ? '<div class="stripe"></div>' : ''}
    ${header}
    <div class="parties">${buildSellerBlock(config, data)}${buildBuyerBlock(config, data)}</div>
    ${tableSection}
    ${buildTotals(config, data)}
    ${buildOrderNote(config, data)}
    ${buildTermsAndNotes(config)}
    ${buildVerificationBlock(config, data)}
    ${buildFooterBlock(config)}`;
}

function renderProfessionalLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const logo = buildLogo(config);
  const header = `
    <div class="banner">
      ${logo}
      ${wrapIf('document-title', docTitle(config))}
      ${wrapIf('document-subtitle', docSubtitle(config))}
    </div>`;

  const detailsTitle =
    documentType === 'packing_slip'
      ? 'Shipment Details'
      : documentType === 'credit_note'
        ? 'Credit Note Details'
        : documentType === 'refund_document'
          ? 'Refund Details'
          : 'Invoice Details';
  const invoicePanel = `
    <div class="box">
      <h3>${esc(detailsTitle)}</h3>
      ${
        documentType === 'packing_slip' && data.orderNumber
          ? `<p>Order: <strong>${esc(data.orderNumber)}</strong></p>`
          : ''
      }
      ${
        (documentType === 'credit_note' || documentType === 'refund_document') &&
        data.originalInvoiceNumber
          ? `<p>Original invoice: <strong>${esc(data.originalInvoiceNumber)}</strong></p>`
          : ''
      }
      ${hasText(data.invoiceNumber) ? `<p>${
        documentType === 'packing_slip'
          ? 'Invoice'
          : documentType === 'credit_note'
            ? 'Credit note'
            : documentType === 'refund_document'
              ? 'Refund'
              : 'No'
      }: <strong>${esc(data.invoiceNumber)}</strong></p>` : ''}
      ${hasText(data.issueDate) ? `<p>Date: ${esc(data.issueDate)}</p>` : ''}
      ${
        documentType === 'packing_slip'
          ? data.shippingMethod
            ? `<p>Ship via: ${esc(data.shippingMethod)}</p>`
            : ''
          : documentType === 'credit_note' || documentType === 'refund_document'
            ? data.reason
              ? `<p>Reason: ${esc(data.reason)}</p>`
              : ''
            : hasText(data.currency)
              ? `<p>Currency: ${esc(data.currency)}</p>`
              : ''
      }
    </div>`;

  const parties =
    config.layout.sellerBuyerLayout === 'stacked'
      ? `<div class="parties">${buildSellerBlock(config, data)}${buildBuyerBlock(config, data)}${invoicePanel}</div>`
      : `<div class="parties" style="grid-template-columns:1.2fr 1fr 1fr">${buildSellerBlock(config, data)}${buildBuyerBlock(config, data)}${invoicePanel}</div>`;

  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildLineItemHeaders(config)}</tr></thead><tbody>${buildLineItemRows(config, data)}</tbody></table>`
    : '';

  return `
    ${header}
    ${parties}
    ${tableSection}
    ${buildTotals(config, data)}
    ${buildOrderNote(config, data)}
    ${buildTermsAndNotes(config)}
    ${buildVerificationBlock(config, data)}
    ${buildFooterBlock(config)}`;
}

function renderEmiratesLayout(
  config: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType
): string {
  const trnBlock =
    documentType === 'packing_slip' || documentType === 'refund_document' || !hasText(data.seller.trn)
      ? ''
      : `
    <div class="trn-block">
      <div>
        <div style="font-size:${config.typography.labelFontSize}px;opacity:0.85">Tax Registration Number (TRN)</div>
        <strong style="font-size:18px">${esc(data.seller.trn)}</strong>
      </div>
      <div style="text-align:right">
        ${hasText(data.seller.legalName) ? `<div style="font-size:${config.typography.labelFontSize}px;opacity:0.85">${esc(data.seller.legalName)}</div>` : ''}
        ${hasText(data.seller.address.emirate) ? `<div>${esc(formatRegionCountryDisplay(data.seller.address.emirate, data.seller.address.country))}</div>` : ''}
      </div>
    </div>`;

  const header = `
    <div class="top">
      <div class="brand">
        ${buildLogo(config)}
        ${wrapIf('document-title', docTitle(config))}
        ${wrapIf('document-subtitle', docSubtitle(config))}
      </div>
      <div class="meta">${buildMetaBlock(config, data, documentType)}</div>
    </div>`;

  const tableSection = config.sections.lineItems.visible
    ? `<table><thead><tr>${buildLineItemHeaders(config)}</tr></thead><tbody>${buildLineItemRows(config, data)}</tbody></table>`
    : '';

  return `
    <div class="stripe"></div>
    ${header}
    ${trnBlock}
    <div class="parties">${buildSellerBlock(config, data)}${buildBuyerBlock(config, data)}</div>
    ${tableSection}
    ${buildTotals(config, data)}
    ${buildOrderNote(config, data)}
    ${buildTermsAndNotes(config)}
    ${buildVerificationBlock(config, data)}
    ${buildFooterBlock(config)}`;
}

export type TemplateRenderOptions = {
  pintStrict?: boolean;
};

export function renderTemplateFromConfig(
  baseLayoutCode: BaseLayoutCode,
  rawConfig: TemplateConfig,
  data: TemplateRenderInvoiceData,
  documentType: DocumentType = 'tax_invoice',
  customHtml?: string | null,
  paginationValidation?: PaginationValidation,
  sourceType?: string | null,
  customCss?: string | null,
  renderOptions: TemplateRenderOptions = {}
): string {
  const config = applyLayoutCapabilityLocks(
    enforceComplianceLocks(rawConfig, documentType, { pintStrict: renderOptions.pintStrict === true }),
    baseLayoutCode
  );
  const html = customHtml?.trim() || '';
  const kind = sourceType === 'code' || sourceType === 'imported' ? sourceType : html ? 'imported' : 'layout';

  if (kind === 'code') {
    if (!html) {
      return `<!DOCTYPE html><html><body style="font-family:system-ui;padding:48px;color:#6d7175;text-align:center">
        <p>Add HTML in Edit code to preview this template.</p></body></html>`;
    }
    try {
      return renderLiquidTemplate(html, data, config, documentType, customCss ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Liquid render failed';
      return `<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;color:#8a1f1f">
        <h1>Template error</h1><pre style="white-space:pre-wrap">${String(message)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</pre></body></html>`;
    }
  }

  if (html) {
    return fillImportedTemplateHtml(html, config, data, documentType, paginationValidation);
  }

  let body = '';
  if (baseLayoutCode === 'professional') {
    body = renderProfessionalLayout(config, data, documentType);
  } else if (baseLayoutCode === 'emirates') {
    body = renderEmiratesLayout(config, data, documentType);
  } else if (baseLayoutCode === 'canvas') {
    body = renderCanvasLayout(config, data, documentType);
  } else if (baseLayoutCode === 'tide') {
    body = renderTideLayout(config, data, documentType);
  } else if (baseLayoutCode === 'folio') {
    body = renderFolioLayout(config, data, documentType);
  } else if (baseLayoutCode === 'bloom') {
    body = renderBloomLayout(config, data, documentType);
  } else if (baseLayoutCode === 'iris') {
    body = renderIrisLayout(config, data, documentType);
  } else if (baseLayoutCode === 'haze') {
    body = renderHazeLayout(config, data, documentType);
  } else if (baseLayoutCode === 'ledger') {
    body = renderLedgerLayout(config, data, documentType);
  } else if (baseLayoutCode === 'noir') {
    body = renderNoirLayout(config, data, documentType);
  } else if (baseLayoutCode === 'slate') {
    body = renderSlateLayout(config, data, documentType);
  } else if (baseLayoutCode === 'charter') {
    body = renderCharterLayout(config, data, documentType);
  } else if (baseLayoutCode === 'matrix') {
    body = renderMatrixLayout(config, data, documentType);
  } else if (baseLayoutCode === 'ember') {
    body = renderEmberLayout(config, data, documentType);
  } else if (baseLayoutCode === 'summit') {
    body = renderSummitLayout(config, data, documentType);
  } else if (baseLayoutCode === 'flare') {
    body = renderFlareLayout(config, data, documentType);
  } else if (baseLayoutCode === 'vault') {
    body = renderVaultLayout(config, data, documentType);
  } else if (baseLayoutCode === 'beacon') {
    body = renderBeaconLayout(config, data, documentType);
  } else if (baseLayoutCode === 'onyx') {
    body = renderOnyxLayout(config, data, documentType);
  } else {
    body = renderModernLayout(config, data, documentType);
  }

  const titlePrefix =
    documentType === 'packing_slip'
      ? 'Packing Slip'
      : documentType === 'credit_note'
        ? 'Credit Note'
        : documentType === 'refund_document'
          ? 'Refund Document'
          : 'Invoice';
  const titleRef = data.orderNumber || data.invoiceNumber;
  const extraCss =
    baseLayoutCode === 'canvas'
      ? canvasStyles(config)
      : baseLayoutCode === 'tide'
        ? tideStyles(config)
        : baseLayoutCode === 'folio'
          ? folioStyles(config)
          : baseLayoutCode === 'bloom'
            ? bloomStyles(config)
            : baseLayoutCode === 'iris'
              ? irisStyles(config)
              : baseLayoutCode === 'haze'
                ? hazeStyles(config)
                : baseLayoutCode === 'ledger'
                  ? ledgerStyles(config)
                  : baseLayoutCode === 'noir'
                    ? noirStyles(config)
                    : baseLayoutCode === 'slate'
                      ? slateStyles(config)
                      : baseLayoutCode === 'charter'
                        ? charterStyles(config)
                        : baseLayoutCode === 'matrix'
                          ? matrixStyles(config)
                          : baseLayoutCode === 'ember'
                            ? emberStyles(config)
                            : baseLayoutCode === 'summit'
                              ? summitStyles(config)
                              : baseLayoutCode === 'flare'
                                ? flareStyles(config)
                                : baseLayoutCode === 'vault'
                                  ? vaultStyles(config)
                                  : baseLayoutCode === 'beacon'
                                    ? beaconStyles(config)
                                    : baseLayoutCode === 'onyx'
                                      ? onyxStyles(config)
                                      : '';

  return `<!DOCTYPE html>
<html lang="${pageLang(config)}" dir="${pageDir(config)}">
<head>
  <meta charset="UTF-8" />
  <title>${esc(titlePrefix)} ${esc(titleRef)}</title>
  <style>${baseStyles(config)}${extraCss}</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

/** Merge multiple already-rendered document HTML bodies into one printable file.
 *  Each document becomes its own `.doc-page` so PDF/print yields N pages for N docs.
 */
export function mergeDocumentHtml(documents: string[], title = 'Documents'): string {
  if (documents.length === 0) return '';
  if (documents.length === 1) return documents[0];

  const pages = documents
    .map((html) => {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      return {
        body: bodyMatch?.[1]?.trim() ?? html,
        style: styleMatch?.[1] ?? '',
      };
    })
    .filter((p) => p.body);

  // Deduplicate identical style blocks (same template repeated)
  const seenStyles = new Set<string>();
  const styles = pages
    .map((p) => p.style)
    .filter((style) => {
      const key = style.trim();
      if (!key || seenStyles.has(key)) return false;
      seenStyles.add(key);
      return true;
    })
    .join('\n');

  const bodies = pages
    .map((p, index) => {
      return `<section class="doc-page" data-doc-index="${index + 1}">${p.body}</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title.replace(/</g, '')} (${pages.length})</title>
  <style>
    ${styles}
    /* Override single-doc body sizing when nested as pages */
    body {
      margin: 0 !important;
      padding: 0 !important;
      min-height: 0 !important;
      width: auto !important;
      background: #fff;
      overflow: visible !important;
    }
    .doc-page {
      display: block;
      box-sizing: border-box;
      padding: 10mm;
      break-after: page;
      page-break-after: always;
    }
    .doc-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    @page {
      size: A4;
      margin: 0;
    }
  </style>
</head>
<body>
  ${bodies}
</body>
</html>`;
}
