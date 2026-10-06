/**
 * Group 14 Phase C — config → Liquid patch sync.
 * Port of uae-invoiceing-app/server/services/template-liquid-sync.service.ts
 */

import type { DocumentType } from '../types/index';
import type { TemplateConfig } from './template-config.types';
import { buildLiquidFromConfig } from './template-liquid.defaults';

type ChangeGroup =
  | 'colors'
  | 'typography'
  | 'headerStyle'
  | 'sellerBuyerLayout'
  | 'logoPosition'
  | 'taxBadge'
  | 'sellerFields'
  | 'buyerFields'
  | 'lineItems'
  | 'totals'
  | 'notesTermsQr';

const ALL_GROUPS: ChangeGroup[] = [
  'colors',
  'typography',
  'headerStyle',
  'sellerBuyerLayout',
  'logoPosition',
  'taxBadge',
  'sellerFields',
  'buyerFields',
  'lineItems',
  'totals',
  'notesTermsQr',
];

/**
 * Apply Style / Layout / Fields onto the merchant's current Liquid.
 * Only the groups that actually changed are patched. Missing selectors are
 * left alone (never invented). @media rules are never written.
 */
export function applyConfigToExistingLiquid(
  existingHtml: string,
  config: TemplateConfig,
  documentType: DocumentType,
  previousConfig?: TemplateConfig | null
): string {
  const source = existingHtml.trim();
  if (!source) {
    return buildLiquidFromConfig(config, documentType);
  }

  const groups = previousConfig
    ? changedGroups(previousConfig, config)
    : new Set<ChangeGroup>(ALL_GROUPS);
  let html = repairCustomHeaderLayout(source);
  if (groups.size === 0) return html;
  if (groups.has('colors') || groups.has('typography')) {
    html = applyStyleTokens(html, config, groups);
  }
  if (groups.has('sellerBuyerLayout')) {
    html = applyPartiesLayout(html, config);
  }
  if (groups.has('logoPosition')) {
    html = applyLogoPosition(html, config);
  }
  if (groups.has('headerStyle')) {
    html = applyHeaderStyle(html, config);
  }
  if (groups.has('taxBadge')) {
    html = applyTaxBadge(html, config);
  }
  if (groups.has('sellerFields') || groups.has('buyerFields')) {
    html = applySellerBuyerFields(html, config, groups);
  }
  if (groups.has('lineItems')) {
    html = applyLineItemColumns(html, config, documentType);
  }
  if (groups.has('totals')) {
    html = applyTotals(html, config, documentType);
  }
  if (groups.has('notesTermsQr')) {
    html = applyNotesTermsQr(html, config);
  }
  return html;
}

function changedGroups(prev: TemplateConfig, next: TemplateConfig): Set<ChangeGroup> {
  const groups = new Set<ChangeGroup>();
  if (
    prev.branding.primaryColor !== next.branding.primaryColor ||
    prev.branding.secondaryColor !== next.branding.secondaryColor ||
    prev.branding.accentColor !== next.branding.accentColor
  ) {
    groups.add('colors');
  }
  if (JSON.stringify(prev.typography) !== JSON.stringify(next.typography)) {
    groups.add('typography');
  }
  if (prev.layout.headerStyle !== next.layout.headerStyle) groups.add('headerStyle');
  if (prev.layout.sellerBuyerLayout !== next.layout.sellerBuyerLayout) {
    groups.add('sellerBuyerLayout');
  }
  if (prev.layout.logoPosition !== next.layout.logoPosition) groups.add('logoPosition');
  if (prev.layout.showTaxBadge !== next.layout.showTaxBadge) groups.add('taxBadge');
  if (JSON.stringify(prev.sections.seller.fields) !== JSON.stringify(next.sections.seller.fields)) {
    groups.add('sellerFields');
  }
  if (
    prev.sections.buyer.visible !== next.sections.buyer.visible ||
    JSON.stringify(prev.sections.buyer.fields) !== JSON.stringify(next.sections.buyer.fields)
  ) {
    groups.add('buyerFields');
  }
  if (JSON.stringify(prev.sections.lineItems.columns) !== JSON.stringify(next.sections.lineItems.columns)) {
    groups.add('lineItems');
  }
  if (JSON.stringify(prev.sections.totals) !== JSON.stringify(next.sections.totals)) {
    groups.add('totals');
  }
  if (
    prev.content.showNotes !== next.content.showNotes ||
    prev.content.showTerms !== next.content.showTerms ||
    prev.sections.qrCode?.visible !== next.sections.qrCode?.visible
  ) {
    groups.add('notesTermsQr');
  }
  return groups;
}

function repairCustomHeaderLayout(html: string): string {
  if (!isCustomHeader(html)) return html;
  const rule = findBaseCssRule(html, '.header');
  if (!rule || !/flex-direction:\s*column/.test(rule.body)) return html;
  html = upsertCss(html, '.header', 'flex-direction', 'row');
  html = upsertCss(html, '.header', 'justify-content', 'center');
  html = upsertCss(html, '.header', 'align-items', 'center');
  return html;
}

function applyStyleTokens(
  html: string,
  config: TemplateConfig,
  groups: Set<ChangeGroup>
): string {
  const branding = config.branding;
  const type = config.typography;

  if (groups.has('colors')) {
    html = upsertCss(html, ':root', '--primary', branding.primaryColor);
    html = upsertCss(html, ':root', '--primary-dark', branding.accentColor);
    html = upsertCss(html, ':root', '--accent', branding.accentColor);
    html = upsertCss(html, '.tax-badge', 'color', branding.accentColor);
    html = upsertCss(html, '.box h3', 'color', branding.secondaryColor);
    html = upsertCss(html, '.party-heading', 'color', branding.secondaryColor);
    html = upsertCss(html, '.footer-label', 'color', branding.secondaryColor);
    html = upsertCss(html, '.footer-heading', 'color', branding.secondaryColor);
    html = upsertCss(html, '.totals .grand', 'border-top', `2px solid ${branding.primaryColor}`);
    html = upsertCss(html, '.totals .grand', 'color', branding.accentColor);
    html = upsertCss(html, '.grand-total', 'background', branding.primaryColor);
    html = upsertCss(html, '.top-accent', 'background', branding.primaryColor);
    html = upsertCss(html, '.stripe', 'background', branding.accentColor);
    html = upsertCss(html, '.party-card::before', 'background', branding.primaryColor);
    if (isStarterHeader(html)) {
      html = upsertCss(html, 'h1', 'color', branding.primaryColor);
    }
  }

  if (groups.has('typography')) {
    html = upsertCss(html, 'body', 'font-family', `${type.fontFamily}, system-ui, sans-serif`);
    html = upsertCss(html, 'body', 'font-size', `${type.baseFontSize}px`);
    html = upsertCss(html, 'h1', 'font-size', `${type.headingFontSize}px`);
    html = upsertCss(html, '.document-title', 'font-size', `${type.headingFontSize}px`);
    html = upsertCss(html, '.box h3', 'font-size', `${type.labelFontSize}px`);
    html = upsertCss(html, '.party-heading', 'font-size', `${type.labelFontSize}px`);
    html = upsertCss(html, 'th', 'font-size', `${type.labelFontSize}px`);
  }

  return html;
}

function applyPartiesLayout(html: string, config: TemplateConfig): string {
  const stacked = config.layout.sellerBuyerLayout === 'stacked';
  html = upsertCss(html, '.parties', 'grid-template-columns', stacked ? '1fr' : '1fr 1fr');
  return html;
}

function applyLogoPosition(html: string, config: TemplateConfig): string {
  const logoCenter = config.layout.logoPosition === 'center';
  if (isCustomHeader(html)) {
    html = upsertCss(html, '.brand', 'text-align', logoCenter ? 'center' : 'left');
    html = upsertCss(html, '.logo', 'object-position', logoCenter ? 'center center' : 'left center');
    html = upsertCss(html, '.logo', 'margin-left', logoCenter ? 'auto' : '0');
    html = upsertCss(html, '.logo', 'margin-right', logoCenter ? 'auto' : '0');
    return html;
  }
  html = upsertCss(html, '.header', 'flex-direction', logoCenter ? 'column' : 'row');
  html = upsertCss(html, '.header', 'justify-content', logoCenter ? 'center' : 'space-between');
  html = upsertCss(html, '.header', 'align-items', logoCenter ? 'center' : 'flex-start');
  html = upsertCss(html, '.meta', 'text-align', logoCenter ? 'center' : 'right');
  return html;
}

function applyHeaderStyle(html: string, config: TemplateConfig): string {
  const branding = config.branding;
  const headerStyle = config.layout.headerStyle;
  const headerBg =
    headerStyle === 'banner' || headerStyle === 'emirates' ? branding.primaryColor : 'transparent';
  const headerColor = headerStyle === 'minimal' ? branding.primaryColor : '#fff';

  html = upsertCss(html, '.header', 'background', headerBg);
  html = upsertCss(html, '.header', 'color', headerColor);
  if (headerStyle === 'minimal') {
    html = upsertCss(html, '.header', 'padding', '0');
    html = upsertCss(html, '.header', 'border-radius', '0');
  } else {
    html = upsertCss(html, '.header', 'padding', '16px');
    html = upsertCss(html, '.header', 'border-radius', '8px');
  }
  if (isStarterHeader(html)) {
    html = upsertCss(html, 'h1', 'color', headerColor);
    html = upsertCss(html, '.sub', 'color', headerStyle === 'minimal' ? '#64748b' : headerColor);
  }

  const stripeHtml = `<div class="stripe" style="background:${branding.accentColor}"></div>`;
  const hasStripe = hasClassName(html, 'stripe');
  const hasTopAccent = hasClassName(html, 'top-accent');
  if (headerStyle === 'emirates' && !hasStripe && !hasTopAccent) {
    html = html.replace(
      /(<div\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>)/i,
      `$1\n    ${stripeHtml}`
    );
  }
  if (headerStyle !== 'emirates' && hasStripe) {
    html = html.replace(/<div\b[^>]*class="[^"]*\bstripe\b[^"]*"[^>]*>\s*<\/div>/gi, '');
  }
  return html;
}

function applyTaxBadge(html: string, config: TemplateConfig): string {
  const badge = '<div class="tax-badge">Tax registered supplier</div>';
  const hasBadge = /class="tax-badge"/.test(html);
  if (config.layout.showTaxBadge) {
    html = upsertCss(html, '.tax-badge', 'color', config.branding.accentColor);
    if (!hasBadge) {
      if (/\{\{\s*content\.subtitle/.test(html)) {
        html = html.replace(
          /(\{\{\s*content\.subtitle[\s\S]*?\}\}\s*<\/p>)/,
          `$1\n        ${badge}`
        );
      } else if (hasClassName(html, 'document-title')) {
        html = html.replace(
          /(<h1\b[^>]*class="[^"]*\bdocument-title\b[^"]*"[^>]*>[\s\S]*?<\/h1>)/i,
          `$1\n        ${badge}`
        );
      }
    }
  } else if (hasBadge) {
    html = html.replace(/<div\b[^>]*class="[^"]*\btax-badge\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  }
  return html;
}

function applySellerBuyerFields(
  html: string,
  config: TemplateConfig,
  groups: Set<ChangeGroup>
): string {
  const showTrn = config.sections.seller.fields.trn !== false;
  const showTrade = config.sections.seller.fields.tradeLicence !== false;
  const showBuyer = config.sections.buyer.visible !== false;
  const showEmail = config.sections.buyer.fields.email !== false;
  const showAddress = config.sections.buyer.fields.address !== false;
  const showPhone = config.sections.buyer.fields.phone !== false;

  if (groups.has('sellerFields')) {
    const trnSnippet =
      '{% if seller.trn %}<div>{{ labels.trn }}: {{ seller.trn }}</div>{% endif %}';
    const tradeSnippet =
      '{% if seller.trade_licence %}<div>Licence: {{ seller.trade_licence }}</div>{% endif %}';
    html = toggleByToken(html, /seller\.trn/, showTrn, trnSnippet, [
      /\{%\s*if\s+seller\.legal_name\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
      /\{\{\s*seller\.legal_name[^}]*\}\}/,
    ]);
    html = toggleByToken(html, /seller\.trade_licence/, showTrade, tradeSnippet, [
      /\{%\s*if\s+seller\.trn\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
      /\{%\s*if\s+seller\.legal_name\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
      /\{\{\s*seller\.legal_name[^}]*\}\}/,
    ]);
  }

  if (!groups.has('buyerFields')) return html;

  const buyerBox = `{% if buyer.name or buyer.email or buyer.phone or buyer.address %}
      <div class="box">
        <h3>{{ labels.buyer }}</h3>
        {% if buyer.name %}<div><strong>{{ buyer.name }}</strong></div>{% endif %}
        ${showEmail ? `{% if buyer.email %}<div>{{ buyer.email }}</div>{% endif %}` : ''}
        ${showPhone ? `{% if buyer.phone %}<div>{{ buyer.phone }}</div>{% endif %}` : ''}
        ${showAddress ? `{% if buyer.address %}<div>{{ buyer.address }}</div>{% endif %}` : ''}
      </div>
      {% endif %}`;

  const hasBuyer = /labels\.buyer|buyer\.name/.test(html);
  if (!showBuyer && hasBuyer) {
    html = removeBlocksContaining(html, ['box', 'party-card'], /labels\.buyer|buyer\.name/);
    html = html.replace(/\{%\s*if\s+buyer\.[^%]+%\}\s*\{%\s*endif\s*%\}/g, '');
  } else if (showBuyer && !hasBuyer && isStarterParties(html)) {
    const parties = findClassBlock(html, 'parties');
    if (parties) {
      const close = `</${parties.tag}>`;
      html =
        html.slice(0, parties.end - close.length) +
        `\n      ${buyerBox}\n    ` +
        html.slice(parties.end - close.length);
    }
  } else if (showBuyer && hasBuyer) {
    html = toggleByToken(
      html,
      /buyer\.email/,
      showEmail,
      '{% if buyer.email %}<div>{{ buyer.email }}</div>{% endif %}',
      [/\{%\s*if\s+buyer\.name\s*%\}[\s\S]*?\{%\s*endif\s*%\}/, /\{\{\s*buyer\.name[^}]*\}\}/]
    );
    html = toggleByToken(
      html,
      /buyer\.phone/,
      showPhone,
      '{% if buyer.phone %}<div>{{ buyer.phone }}</div>{% endif %}',
      [
        /\{%\s*if\s+buyer\.email\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
        /\{%\s*if\s+buyer\.name\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
      ]
    );
    html = toggleByToken(
      html,
      /buyer\.address/,
      showAddress,
      '{% if buyer.address %}<div>{{ buyer.address }}</div>{% endif %}',
      [
        /\{%\s*if\s+buyer\.phone\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
        /\{%\s*if\s+buyer\.email\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
        /\{%\s*if\s+buyer\.name\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
      ]
    );
    html = syncBuyerIfCondition(html, showEmail, showPhone, showAddress);
  }

  return html;
}

function applyLineItemColumns(
  html: string,
  config: TemplateConfig,
  documentType: DocumentType
): string {
  const showPrices = documentType !== 'packing_slip';
  const cols = config.sections.lineItems.columns;
  const showSku = cols.sku === true;
  const showImage = cols.productImage === true;
  const showBarcode = cols.barcode === true;
  const showQty = cols.quantity !== false;
  const showUnit = showPrices && cols.unitPrice !== false;
  const showDiscount = showPrices && cols.discount !== false;
  const showVatCol = showPrices && cols.vatRate !== false;
  const showLineTotal = showPrices && cols.lineTotal !== false;

  const skuSnippet =
    '{% if item.sku %}<div class="sub">SKU {{ item.sku }}</div>{% endif %}';
  const imageSnippet =
    '{% if item.image_url %}<img class="thumb" src="{{ item.image_url }}" alt="" />{% endif %}';
  const barcodeSnippet =
    '{% if item.barcode_data_url %}<img class="barcode" src="{{ item.barcode_data_url }}" alt="" />{% endif %}';

  html = toggleInnerSnippet(
    html,
    /\{%\s*if\s+item\.sku\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
    /item\.sku/,
    showSku,
    skuSnippet,
    /item\.description/
  );
  html = toggleInnerSnippet(
    html,
    /\{%\s*if\s+item\.image_url\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
    /item\.image_url/,
    showImage,
    imageSnippet,
    /item\.description/
  );
  html = toggleInnerSnippet(
    html,
    /\{%\s*if\s+item\.barcode_data_url\s*%\}[\s\S]*?\{%\s*endif\s*%\}/,
    /item\.barcode_data_url/,
    showBarcode,
    barcodeSnippet,
    /item\.description/
  );

  const optional: Array<{ show: boolean; test: RegExp; th: string; td: string }> = [
    { show: showQty, test: /item\.quantity/, th: '<th>Qty</th>', td: '<td>{{ item.quantity }}</td>' },
    {
      show: showUnit,
      test: /item\.unit_price/,
      th: '<th class="num">Unit</th>',
      td: '<td class="num">{{ item.unit_price }}</td>',
    },
    {
      show: showDiscount,
      test: /item\.discount/,
      th: '<th class="num">Disc</th>',
      td: '<td class="num">{{ item.discount }}</td>',
    },
    {
      show: showVatCol,
      test: /item\.vat_rate/,
      th: '<th class="num">VAT</th>',
      td: '<td class="num">{{ item.vat_rate }}</td>',
    },
    {
      show: showLineTotal,
      test: /item\.line_total/,
      th: '<th class="num">Total</th>',
      td: '<td class="num">{{ item.line_total }}</td>',
    },
  ];

  const theadMatch = html.match(/<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
  const loopMatch = html.match(
    /\{%\s*for\s+item\s+in\s+line_items\s*%\}[\s\S]*?<tr>([\s\S]*?)<\/tr>/i
  );
  if (!theadMatch || !loopMatch) return html;

  const thCells = splitCells(theadMatch[1], 'th');
  const tdCells = splitCells(loopMatch[1], 'td');
  if (thCells.length === 0 || tdCells.length === 0) return html;

  for (const col of optional) {
    const thIdx = thCells.findIndex((cell) => col.test.test(cell));
    const tdIdx = tdCells.findIndex((cell) => col.test.test(cell));
    if (col.show) {
      if (tdIdx < 0) {
        tdCells.push(col.td);
        thCells.push(col.th);
      }
    } else {
      if (thIdx >= 0) thCells.splice(thIdx, 1);
      const tdLater = tdCells.findIndex(
        (cell) => col.test.test(cell) && !/item\.description/.test(cell)
      );
      if (tdLater >= 0) tdCells.splice(tdLater, 1);
    }
  }

  const nextThead = theadMatch[0].replace(theadMatch[1], `\n          ${thCells.join('\n          ')}\n        `);
  const nextLoop = loopMatch[0].replace(loopMatch[1], `\n          ${tdCells.join('\n          ')}\n        `);
  html = html.replace(theadMatch[0], nextThead).replace(loopMatch[0], nextLoop);
  return html;
}

function applyTotals(html: string, config: TemplateConfig, documentType: DocumentType): string {
  const showPrices = documentType !== 'packing_slip';
  const totals = config.sections.totals;
  const showTotals = showPrices && totals.visible !== false;
  const custom = hasCustomTotalsMarkup(html);

  if (custom) {
    html = setClassHidden(html, 'totals', !showTotals);
    html = setClassHidden(html, 'summary-area', !showTotals);
    html = toggleByToken(
      html,
      /totals\.subtotal/,
      totals.showSubtotal !== false,
      '<div class="total-row"><span>{{ labels.subtotal }}</span><span class="amount">{{ totals.subtotal }}</span></div>',
      []
    );
    html = toggleByToken(
      html,
      /totals\.discount/,
      totals.showDiscount !== false,
      '{% if totals.discount %}<div class="total-row"><span>{{ labels.discount }}</span><span class="amount">{{ totals.discount }}</span></div>{% endif %}',
      []
    );
    html = toggleByToken(
      html,
      /totals\.vat_total/,
      totals.showVat !== false,
      '<div class="total-row"><span>{{ labels.vat }}</span><span class="amount">{{ totals.vat_total }}</span></div>',
      []
    );
    html = toggleByToken(
      html,
      /totals\.shipping/,
      totals.showShipping !== false,
      '{% if totals.shipping %}<div class="total-row"><span>{{ labels.shipping }}</span><span class="amount">{{ totals.shipping }}</span></div>{% endif %}',
      []
    );
    html = toggleByToken(
      html,
      /totals\.grand_total/,
      totals.showGrandTotal !== false,
      '<div class="grand-total"><span class="label">{{ labels.grand_total }}</span><span class="amount">{{ invoice.currency }} {{ totals.grand_total }}</span></div>',
      []
    );
    return html;
  }

  const rows: string[] = [];
  if (totals.showSubtotal !== false) {
    rows.push('<div class="row"><span>{{ labels.subtotal }}</span><span>{{ totals.subtotal }}</span></div>');
  }
  if (totals.showDiscount !== false) {
    rows.push(
      '{% if totals.discount %}<div class="row"><span>{{ labels.discount }}</span><span>{{ totals.discount }}</span></div>{% endif %}'
    );
  }
  if (totals.showVat !== false) {
    rows.push('<div class="row"><span>{{ labels.vat }}</span><span>{{ totals.vat_total }}</span></div>');
  }
  if (totals.showShipping !== false) {
    rows.push(
      '{% if totals.shipping %}<div class="row"><span>{{ labels.shipping }}</span><span>{{ totals.shipping }}</span></div>{% endif %}'
    );
  }
  if (totals.showGrandTotal !== false) {
    rows.push(
      '<div class="row grand"><span>{{ labels.grand_total }}</span><span>{{ invoice.currency }} {{ totals.grand_total }}</span></div>'
    );
  }

  const block = findClassBlock(html, 'totals');
  if (!showTotals) {
    if (block) html = setClassHidden(html, 'totals', true);
    return html;
  }

  html = setClassHidden(html, 'totals', false);
  const inner = `\n      ${rows.join('\n      ')}\n    `;
  const visible = findClassBlock(html, 'totals');
  if (visible) {
    const openEnd = html.indexOf('>', visible.start) + 1;
    const close = `</${visible.tag}>`;
    html = html.slice(0, openEnd) + inner + html.slice(visible.end - close.length);
    return html;
  }

  const tableClose = html.lastIndexOf('</table>');
  if (tableClose >= 0) {
    const insert = `\n\n    <div class="totals">${inner}</div>\n`;
    html = html.slice(0, tableClose + '</table>'.length) + insert + html.slice(tableClose + '</table>'.length);
  }
  return html;
}

function applyNotesTermsQr(html: string, config: TemplateConfig): string {
  const showNotes = config.content.showNotes !== false;
  const showTerms = config.content.showTerms !== false;
  const showQr = config.sections.qrCode?.visible === true;

  const notesSnippet = `{% if content.note %}
      <div class="footer"><div class="footer-label">Notes</div>{{ content.note }}</div>
    {% endif %}`;
  const termsSnippet = `{% if content.terms %}
      <div class="footer"><div class="footer-label">Terms &amp; conditions</div>{{ content.terms }}</div>
    {% endif %}`;
  const qrSnippet = `{% if qr_html %}
      <div class="qr">{{ qr_html }}</div>
    {% endif %}`;

  html = toggleBlockByTest(
    html,
    /content\.note/,
    showNotes,
    notesSnippet,
    /\{%\s*if\s+content\.note\s*%\}[\s\S]*?\{%\s*endif\s*%\}/
  );
  html = toggleBlockByTest(
    html,
    /content\.terms/,
    showTerms,
    termsSnippet,
    /\{%\s*if\s+content\.terms\s*%\}[\s\S]*?\{%\s*endif\s*%\}/
  );
  html = toggleBlockByTest(
    html,
    /qr_html/,
    showQr,
    qrSnippet,
    /\{%\s*if\s+qr_html\s*%\}[\s\S]*?\{%\s*endif\s*%\}/
  );
  return html;
}

function syncBuyerIfCondition(
  html: string,
  showEmail: boolean,
  showPhone: boolean,
  showAddress: boolean
): string {
  const parts = ['buyer.name'];
  if (showEmail) parts.push('buyer.email');
  if (showPhone) parts.push('buyer.phone');
  if (showAddress) parts.push('buyer.address');
  return html.replace(
    /\{%\s*if\s+buyer\.name(?:\s+or\s+buyer\.\w+)*\s*%\}/,
    `{% if ${parts.join(' or ')} %}`
  );
}

function toggleByToken(
  html: string,
  test: RegExp,
  show: boolean,
  snippet: string,
  insertAfter: RegExp[]
): string {
  const present = test.test(html);
  if (show && !present) {
    for (const pattern of insertAfter) {
      const match = html.match(pattern);
      if (match && match.index != null) {
        const at = match.index + match[0].length;
        return html.slice(0, at) + `\n        ${snippet}` + html.slice(at);
      }
    }
    return html;
  }
  if (!show && present) {
    const token = test.source;
    html = html.replace(
      new RegExp(`\\{%\\s*if\\s+${token}\\s*%\\}[\\s\\S]*?\\{%\\s*endif\\s*%\\}`, 'g'),
      ''
    );
    html = html.replace(
      new RegExp(
        `<div[^>]*class="[^"]*"(?:[^>]*)>[\\s\\S]*?\\{\\{\\s*${token}[^}]*\\}\\}[\\s\\S]*?</div>`,
        'g'
      ),
      (chunk) => (new RegExp(token).test(chunk) && !/item\.description/.test(chunk) ? '' : chunk)
    );
    html = html.replace(
      new RegExp(`<div[^>]*>[^<]*\\{\\{\\s*${token}[^}]*\\}\\}[^<]*</div>`, 'g'),
      ''
    );
  }
  return html;
}

function removeBlocksContaining(html: string, classNames: string[], test: RegExp): string {
  for (const className of classNames) {
    const boxes = findAllClassBlocks(html, className);
    for (let i = boxes.length - 1; i >= 0; i -= 1) {
      const block = boxes[i];
      const chunk = html.slice(block.start, block.end);
      if (test.test(chunk)) {
        html = html.slice(0, block.start) + html.slice(block.end);
      }
    }
  }
  return html;
}

function toggleInnerSnippet(
  html: string,
  blockRe: RegExp,
  test: RegExp,
  show: boolean,
  snippet: string,
  insertAfter: RegExp
): string {
  const present = test.test(html);
  if (show && !present) {
    const after = html.match(
      new RegExp(
        `(\\{%\\s*if\\s+${insertAfter.source}[\\s\\S]*?\\{%\\s*endif\\s*%\\}|\\{\\{\\s*${insertAfter.source}[^}]*\\}\\})`
      )
    );
    if (after) return html.replace(after[1], `${after[1]}\n            ${snippet}`);
    return html;
  }
  if (!show && present) {
    return html.replace(new RegExp(blockRe.source, 'g'), '');
  }
  return html;
}

function toggleBlockByTest(
  html: string,
  test: RegExp,
  show: boolean,
  snippet: string,
  removeRe: RegExp
): string {
  const present = test.test(html);
  if (show && !present) return insertBeforePageClose(html, snippet);
  if (!show && present) return html.replace(new RegExp(removeRe.source, 'g'), '');
  return html;
}

function insertBeforePageClose(html: string, snippet: string): string {
  const page = findClassBlock(html, 'page');
  if (page) {
    const close = `</${page.tag}>`;
    return html.slice(0, page.end - close.length) + `\n    ${snippet}\n  ` + html.slice(page.end - close.length);
  }
  return html.replace(/<\/body>/i, `  ${snippet}\n</body>`);
}

function splitCells(rowInner: string, tag: 'th' | 'td'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  return rowInner.match(re) || [];
}

type ClassBlock = { start: number; end: number; tag: string };

function findClassBlock(html: string, className: string): ClassBlock | null {
  const openRe = new RegExp(
    `<(div|section|header|article|aside)\\b[^>]*class="[^"]*\\b${className}\\b(?!-)[^"]*"[^>]*>`,
    'i'
  );
  const match = openRe.exec(html);
  if (!match || match.index == null) return null;
  return findClassBlockFrom(html, match.index);
}

function findAllClassBlocks(html: string, className: string): ClassBlock[] {
  const blocks: ClassBlock[] = [];
  const openRe = new RegExp(
    `<(div|section|header|article|aside)\\b[^>]*class="[^"]*\\b${className}\\b(?!-)[^"]*"[^>]*>`,
    'gi'
  );
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(html))) {
    const block = findClassBlockFrom(html, match.index);
    if (block) {
      blocks.push(block);
      openRe.lastIndex = block.end;
    }
  }
  return blocks;
}

function findClassBlockFrom(html: string, start: number): ClassBlock | null {
  const open = html.slice(start).match(/^<(\w+)/);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  let depth = 0;
  const token = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
  token.lastIndex = start;
  let found: RegExpExecArray | null;
  while ((found = token.exec(html))) {
    const tokenText = found[0];
    if (new RegExp(`^<${tag}\\b`, 'i').test(tokenText) && !/\/>$/.test(tokenText)) depth += 1;
    else if (new RegExp(`^</${tag}`, 'i').test(tokenText)) {
      depth -= 1;
      if (depth === 0) {
        return { start, end: found.index + tokenText.length, tag };
      }
    }
  }
  return null;
}

function setClassHidden(html: string, className: string, hidden: boolean): string {
  const openRe = new RegExp(
    `<(div|section|header|article|aside)\\b([^>]*class="[^"]*\\b${className}\\b(?!-)[^"]*"[^>]*)>`,
    'gi'
  );
  return html.replace(openRe, (_full, tag: string, attrs: string) => {
    const cleaned = attrs.replace(/\s+hidden(?:="[^"]*")?/gi, '');
    if (hidden) return `<${tag}${cleaned} hidden>`;
    return `<${tag}${cleaned}>`;
  });
}

function hasClassName(html: string, name: string): boolean {
  return new RegExp(`class=["'][^"']*\\b${name}\\b(?!-)`, 'i').test(html);
}

function isCustomHeader(html: string): boolean {
  return hasClassName(html, 'meta-card') || hasClassName(html, 'brand');
}

function isStarterHeader(html: string): boolean {
  return hasClassName(html, 'meta') && !isCustomHeader(html);
}

function isStarterParties(html: string): boolean {
  return hasClassName(html, 'box') && !hasClassName(html, 'party-card');
}

function hasCustomTotalsMarkup(html: string): boolean {
  return hasClassName(html, 'total-row') || hasClassName(html, 'grand-total');
}

function isInsideAtRule(source: string, index: number): boolean {
  let depth = 0;
  let atRuleDepth = -1;
  let pendingAt = false;
  for (let i = 0; i < index; i += 1) {
    if (
      source.startsWith('@media', i) ||
      source.startsWith('@page', i) ||
      source.startsWith('@supports', i)
    ) {
      pendingAt = true;
    }
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
      if (pendingAt) {
        atRuleDepth = depth;
        pendingAt = false;
      }
    } else if (ch === '}') {
      if (atRuleDepth === depth) atRuleDepth = -1;
      depth -= 1;
    }
  }
  return atRuleDepth !== -1;
}

function findBaseCssRule(
  html: string,
  selector: string
): { open: string; body: string; close: string; index: number; length: number } | null {
  const sel = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ruleRe = new RegExp(`((?:^|[^a-zA-Z0-9_-])${sel}\\s*\\{)([^}]*)(\\})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(html))) {
    const braceAt = match.index + match[1].lastIndexOf('{');
    const beforeSel = html.slice(Math.max(0, braceAt - selector.length - 8), braceAt);
    if (/[a-zA-Z0-9_-]\s+$/.test(beforeSel.replace(new RegExp(`${sel}\\s*$`), ''))) continue;
    if (isInsideAtRule(html, braceAt)) continue;
    return {
      open: match[1],
      body: match[2],
      close: match[3],
      index: match.index,
      length: match[0].length,
    };
  }
  return null;
}

/**
 * Update a property on the first base (non-@media) rule.
 * If that selector does not exist at the base level, leave the document unchanged.
 */
function upsertCss(html: string, selector: string, property: string, value: string): string {
  const rule = findBaseCssRule(html, selector);
  if (!rule) return html;
  const body = rule.body;
  const propRe = new RegExp(`(${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:)([^;]*)(;)`);
  const nextBody = propRe.test(body)
    ? body.replace(propRe, `$1 ${value}$3`)
    : `${body.replace(/\s*$/, '')}\n      ${property}: ${value};\n    `;
  return html.slice(0, rule.index) + rule.open + nextBody + rule.close + html.slice(rule.index + rule.length);
}
