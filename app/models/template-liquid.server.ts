/**
 * Group 14 Phase C — Liquid validate / context / render.
 * Port of uae-invoiceing-app/server/services/template-liquid.service.ts
 */

import { Liquid } from 'liquidjs';
import type { DocumentType } from '../types/index';
import type { TemplateConfig } from './template-config.types';
import { buildVerificationQrHtml } from './verification-qr.server';
import { buildSocialLinksHtml } from './social-links.server';
import type { TemplateRenderInvoiceData } from './template-render-engine.server';
import { defaultLiquidSource } from './template-liquid.defaults';
import { richTextOrEmpty } from './rich-text.server';

export {
  buildLiquidFromConfig,
  defaultLiquidSource,
  LIQUID_VARIABLE_HELP,
} from './template-liquid.defaults';

export function templateSourceKind(template: {
  sourceType?: string | null;
  customHtml?: string | null;
}): 'layout' | 'imported' | 'code' {
  if (template.sourceType === 'code') return 'code';
  if (template.sourceType === 'imported') return 'imported';
  if (typeof template.customHtml === 'string' && template.customHtml.trim()) return 'imported';
  return 'layout';
}

const MAX_SOURCE_CHARS = 150_000;

const engine = new Liquid({
  cache: false,
  dynamicPartials: false,
  relativeReference: false,
  strictFilters: false,
  strictVariables: false,
  // In-memory lookup only — do not pass fs: undefined (Liquid crashes on dirname).
  templates: {},
});

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sellerAddressLine(data: TemplateRenderInvoiceData): string {
  const a = data.seller.address;
  return [a.line1, a.city, a.emirate].filter(Boolean).join(', ');
}

function moneyOrEmpty(value: string | undefined | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[, ]/g, ''));
  if (Number.isFinite(n) && n === 0) return '';
  return raw;
}

function plainTextFromHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function documentTitlePlain(config: TemplateConfig, documentType: DocumentType): string {
  const text = plainTextFromHtml(config.content.documentTitle.html);
  if (text) return text;
  if (documentType === 'packing_slip') return 'Packing Slip';
  if (documentType === 'credit_note') return 'Credit Note';
  if (documentType === 'refund_document') return 'Refund Document';
  return 'Tax Invoice';
}

function documentTitleHtml(config: TemplateConfig, documentType: DocumentType): string {
  const html = config.content.documentTitle.html.trim();
  if (html) return html;
  return documentTitlePlain(config, documentType);
}

function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function buildLiquidContext(
  data: TemplateRenderInvoiceData,
  config: TemplateConfig,
  documentType: DocumentType,
  extraCss = ''
): Record<string, unknown> {
  const qrHtml = buildVerificationQrHtml(config.sections.qrCode?.visible === true, data.verification);
  const socialHtml = buildSocialLinksHtml({
    visible: config.socialLinks?.visible === true,
    links: config.socialLinks?.links ?? [],
  });
  const sellerLine = sellerAddressLine(data);
  const titleHtml = documentTitleHtml(config, documentType);
  const titlePlain = documentTitlePlain(config, documentType);
  const subtitleHtml = richTextOrEmpty(config.content.subtitle.html);
  const subtitlePlain = plainTextFromHtml(subtitleHtml);
  const footerHtml = richTextOrEmpty(config.content.footer.html);
  const termsHtml =
    config.content.showTerms === false ? '' : richTextOrEmpty(config.content.terms.html);
  const noteHtml =
    config.content.showNotes === false ? '' : richTextOrEmpty(config.content.customNote.html);
  const discount = moneyOrEmpty(data.totals.discount);
  const shipping = moneyOrEmpty(data.totals.shipping);

  const nested = {
    document: {
      type: documentType,
      title: titleHtml,
      title_plain: titlePlain,
      subtitle: subtitleHtml || subtitlePlain,
      subtitle_plain: subtitlePlain,
    },
    invoice: {
      number: esc(data.invoiceNumber),
      order_number: esc(data.orderNumber ?? ''),
      issue_date: esc(data.issueDate),
      due_date: esc(data.dueDate || data.issueDate),
      currency: esc(data.currency),
      shipping_method: esc(data.shippingMethod ?? ''),
      order_note: esc(data.orderNote ?? ''),
      original_number: esc(data.originalInvoiceNumber ?? ''),
      reason: esc(data.reason ?? ''),
    },
    seller: {
      legal_name: esc(data.seller.legalName),
      trn: esc(data.seller.trn),
      trade_licence: esc(data.seller.tradeLicence),
      emirate: esc(data.seller.address.emirate),
      address: data.seller.address,
      address_line: esc(sellerLine),
    },
    buyer: {
      name: esc(data.buyer.name),
      email: esc(data.buyer.email),
      phone: esc(data.buyer.phone ?? ''),
      address: esc(data.buyer.addressLine ?? ''),
    },
    line_items: data.lineItems.map((item) => ({
      description: esc(item.description),
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount: item.discount,
      vat_rate: item.vatRate,
      vat_amount: item.vatAmount,
      line_total: item.lineTotal,
      sku: esc(item.sku ?? ''),
      product_title: esc(item.productTitle ?? ''),
      variant_title: esc(item.variantTitle ?? ''),
      image_url: item.imageUrl ?? '',
      barcode: esc(item.barcode ?? ''),
      barcode_data_url: item.barcodeDataUrl ?? '',
    })),
    totals: {
      subtotal: data.totals.subtotal,
      discount,
      vat_total: data.totals.vatTotal,
      shipping,
      grand_total: data.totals.grandTotal,
      has_discount: Boolean(discount),
      has_shipping: Boolean(shipping),
    },
    branding: {
      logo_url: config.branding.logoUrl,
      primary_color: config.branding.primaryColor,
      secondary_color: config.branding.secondaryColor,
      accent_color: config.branding.accentColor,
      font_family: config.typography.fontFamily,
      font_size: String(config.typography.baseFontSize),
    },
    labels: {
      seller: config.labels.seller ?? 'Seller',
      buyer: config.labels.buyer ?? 'Buyer',
      trn: config.labels.trn ?? 'TRN',
      invoice_number: config.labels.invoiceNumber ?? 'Invoice Number',
      subtotal: config.labels.subtotal ?? 'Subtotal',
      vat: config.labels.vatTotal ?? 'VAT Total',
      grand_total: config.labels.grandTotal ?? 'Grand Total',
      discount: config.labels.discount ?? 'Discount',
      shipping: config.labels.shipping ?? 'Shipping',
      order_number: config.labels.orderNumber ?? 'Order',
      issue_date: config.labels.issueDate ?? 'Issue date',
    },
    content: {
      title: titleHtml,
      subtitle: subtitleHtml,
      footer: footerHtml,
      terms: termsHtml,
      note: noteHtml,
    },
    qr_html: qrHtml,
    social_html: socialHtml,
    custom_css: extraCss ? `<style>${stripUnsafeHtml(extraCss)}</style>` : '',
  };

  return {
    ...nested,
    invoice_number: esc(data.invoiceNumber),
    order_number: esc(data.orderNumber ?? ''),
    issue_date: esc(data.issueDate),
    due_date: esc(data.dueDate || data.issueDate),
    currency: esc(data.currency),
    shipping_method: esc(data.shippingMethod ?? ''),
    order_note: esc(data.orderNote ?? ''),
    original_invoice_number: esc(data.originalInvoiceNumber ?? ''),
    reason: esc(data.reason ?? ''),
    seller_legal_name: esc(data.seller.legalName),
    seller_trn: esc(data.seller.trn),
    seller_trade_licence: esc(data.seller.tradeLicence),
    seller_emirate: esc(data.seller.address.emirate),
    seller_address: esc(sellerLine),
    buyer_name: esc(data.buyer.name),
    buyer_email: esc(data.buyer.email),
    buyer_phone: esc(data.buyer.phone ?? ''),
    buyer_address: esc(data.buyer.addressLine ?? ''),
    subtotal: data.totals.subtotal,
    discount,
    vat_total: data.totals.vatTotal,
    shipping,
    grand_total: data.totals.grandTotal,
    verification_qr: qrHtml,
    social_links: socialHtml,
    terms: termsHtml,
    custom_note: noteHtml,
  };
}

export interface LiquidFieldCheck {
  id: string;
  label: string;
  ok: boolean;
  level: 'error' | 'warning';
}

export interface LiquidValidation {
  errors: string[];
  warnings: string[];
  checks: LiquidFieldCheck[];
  syntaxLine: number | null;
}

function liquidErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Liquid syntax error.';
  const err = error as {
    message?: string;
    token?: { getPosition?: () => number[] };
  };
  const message = err.message || 'Liquid syntax error.';
  const pos = err.token?.getPosition?.();
  const lineFromPos = pos && pos.length >= 1 ? Number(pos[0]) : NaN;
  const lineFromText = Number((message.match(/line:?\s*(\d+)/i) || [])[1]);
  const line = Number.isFinite(lineFromPos) && lineFromPos > 0 ? lineFromPos : lineFromText;
  if (Number.isFinite(line) && line > 0) {
    const clean = message.replace(/,?\s*line:?\s*\d+(,\s*col:?\s*\d+)?/gi, '').trim();
    return `Liquid syntax error at line ${line}: ${clean || message}`;
  }
  return message.startsWith('Liquid') ? message : `Liquid syntax error: ${message}`;
}

function lineFromErrorText(message: string): number | null {
  const match = message.match(/line\s+(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type FieldRule = {
  id: string;
  label: string;
  hint: string;
  pattern: RegExp;
  level: 'error' | 'warning';
  types: DocumentType[];
};

const FIELD_RULES: FieldRule[] = [
  {
    id: 'invoice_number',
    label: 'Document number',
    hint: 'Add {{ invoice.number }} so the document number prints.',
    pattern: /invoice\.number|invoice_number/i,
    level: 'error',
    types: ['tax_invoice', 'credit_note', 'refund_document'],
  },
  {
    id: 'seller_trn',
    label: 'Seller TRN',
    hint: 'Add {{ seller.trn }} — required on tax invoices when VAT registered.',
    pattern: /seller\.trn|seller_trn/i,
    level: 'error',
    types: ['tax_invoice', 'credit_note'],
  },
  {
    id: 'vat',
    label: 'VAT amount',
    hint: 'Add {{ totals.vat_total }} (or line VAT) so tax is visible.',
    pattern: /vat_total|totals\.vat|item\.vat/i,
    level: 'error',
    types: ['tax_invoice', 'credit_note'],
  },
  {
    id: 'line_items',
    label: 'Line items',
    hint: 'Add {% for item in line_items %} so products print.',
    pattern: /line_items|for item/i,
    level: 'error',
    types: ['tax_invoice', 'credit_note', 'refund_document', 'packing_slip'],
  },
  {
    id: 'seller_name',
    label: 'Seller name',
    hint: 'Add {{ seller.legal_name }} so the supplier is identified.',
    pattern: /seller\.legal_name|seller_legal_name/i,
    level: 'warning',
    types: ['tax_invoice', 'credit_note', 'refund_document'],
  },
  {
    id: 'buyer_name',
    label: 'Buyer name',
    hint: 'Add {{ buyer.name }} so the customer is identified.',
    pattern: /buyer\.name|buyer_name/i,
    level: 'warning',
    types: ['tax_invoice', 'credit_note', 'refund_document', 'packing_slip'],
  },
  {
    id: 'grand_total',
    label: 'Grand total',
    hint: 'Add {{ totals.grand_total }} so the payable amount prints.',
    pattern: /grand_total|totals\.grand/i,
    level: 'warning',
    types: ['tax_invoice', 'credit_note', 'refund_document'],
  },
  {
    id: 'qr',
    label: 'Verification QR',
    hint: 'Add {{ qr_html }} to include the verification QR.',
    pattern: /qr_html|verification_qr/i,
    level: 'warning',
    types: ['tax_invoice'],
  },
  {
    id: 'original_invoice',
    label: 'Original invoice',
    hint: 'Add {{ invoice.original_number }} to link the credit note to the tax invoice.',
    pattern: /original_number|original_invoice_number/i,
    level: 'warning',
    types: ['credit_note'],
  },
];

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function snippetAt(source: string, start: number, end: number): string {
  return source
    .slice(start, Math.min(end, start + 56))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Skip a Liquid tag/output. Returns the index after it, or -1 if it is unclosed. */
function skipLiquidBlock(source: string, i: number): number {
  if (source.startsWith('{{', i)) {
    const end = source.indexOf('}}', i + 2);
    return end === -1 ? -1 : end + 2;
  }
  if (source.startsWith('{%', i)) {
    const end = source.indexOf('%}', i + 2);
    return end === -1 ? -1 : end + 2;
  }
  return i;
}

/**
 * Catch broken markup Liquid ignores, e.g. `</title` without `>`.
 * Skips {{ }} / {% %} so invoice variables inside attributes stay valid.
 */
export function validateHtmlMarkup(source: string): string[] {
  const errors: string[] = [];
  const limit = 8;
  let i = 0;

  const push = (message: string) => {
    if (errors.length < limit) errors.push(message);
  };

  while (i < source.length && errors.length < limit) {
    const liquidEnd = skipLiquidBlock(source, i);
    if (liquidEnd === -1) {
      const kind = source.startsWith('{{', i) ? '{{ ... }}' : '{% ... %}';
      push(`Unclosed Liquid ${kind} at line ${lineAt(source, i)}.`);
      break;
    }
    if (liquidEnd !== i) {
      i = liquidEnd;
      continue;
    }

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end === -1) {
        push(`Unclosed HTML comment starting at line ${lineAt(source, i)}.`);
        break;
      }
      i = end + 3;
      continue;
    }

    if (source[i] !== '<') {
      i += 1;
      continue;
    }

    const tagStart = i;
    i += 1;
    let closed = false;
    while (i < source.length) {
      const innerLiquid = skipLiquidBlock(source, i);
      if (innerLiquid === -1) {
        const kind = source.startsWith('{{', i) ? '{{ ... }}' : '{% ... %}';
        push(`Unclosed Liquid ${kind} at line ${lineAt(source, i)}.`);
        return errors;
      }
      if (innerLiquid !== i) {
        i = innerLiquid;
        continue;
      }
      if (source[i] === '>') {
        closed = true;
        i += 1;
        break;
      }
      if (source[i] === '<') {
        break;
      }
      i += 1;
    }

    if (!closed) {
      const near = snippetAt(source, tagStart, i);
      push(
        `HTML tag is missing ">" at line ${lineAt(source, tagStart)}${near ? ` (near "${near}")` : ''}.`
      );
    }
  }

  return errors;
}

export function validateLiquidSource(source: string, documentType: DocumentType): LiquidValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: LiquidFieldCheck[] = [];
  const text = source || '';

  if (!text.trim()) {
    errors.push('HTML / Liquid cannot be empty.');
    return { errors, warnings, checks, syntaxLine: null };
  }
  if (text.length > MAX_SOURCE_CHARS) {
    errors.push('Template source is too large (max 150 KB).');
  }

  try {
    engine.parse(text);
  } catch (error) {
    errors.push(liquidErrorMessage(error));
  }

  const htmlErrors = validateHtmlMarkup(text);
  errors.push(...htmlErrors);
  checks.push({
    id: 'html_markup',
    label: 'HTML tags closed',
    ok: htmlErrors.length === 0,
    level: 'error',
  });

  for (const rule of FIELD_RULES) {
    if (!rule.types.includes(documentType)) continue;
    const ok = rule.pattern.test(text);
    checks.push({ id: rule.id, label: rule.label, ok, level: rule.level });
    if (ok) continue;
    if (rule.level === 'error') errors.push(rule.hint);
    else warnings.push(rule.hint);
  }

  const syntaxLine =
    errors.map(lineFromErrorText).find((line): line is number => typeof line === 'number') ?? null;

  return { errors, warnings, checks, syntaxLine };
}

export function renderLiquidTemplate(
  source: string,
  data: TemplateRenderInvoiceData,
  config: TemplateConfig,
  documentType: DocumentType,
  extraCss = ''
): string {
  if (!source.trim()) {
    throw new Error('Liquid template is empty');
  }
  if (source.length > MAX_SOURCE_CHARS) {
    throw new Error('Liquid template is too large');
  }

  const context = buildLiquidContext(data, config, documentType, extraCss);
  const rendered = engine.parseAndRenderSync(source, context);
  return stripUnsafeHtml(rendered);
}

export function starterLiquidFor(documentType: DocumentType, existingHtml?: string | null): string {
  const html = existingHtml?.trim();
  if (html) return html;
  return defaultLiquidSource(documentType);
}
