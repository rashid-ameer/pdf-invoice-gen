import type { DocumentType } from "../types/index";
import {
  templateConfigSchema,
  type BaseLayoutCode,
  type TemplateConfig,
} from "./template-config.types";

export function defaultLiquidSource(documentType: DocumentType): string {
  const config = templateConfigSchema.parse({
    branding: { logoUrl: '', primaryColor: '#008060', secondaryColor: '#6d7175', accentColor: '#004c3f' },
    typography: { fontFamily: 'Segoe UI', baseFontSize: 13, headingFontSize: 26, labelFontSize: 11 },
    layout: { headerStyle: 'minimal', sellerBuyerLayout: 'side-by-side', logoPosition: 'left', showTaxBadge: true },
    content: {
      documentTitle: { html: '' },
      subtitle: { html: '' },
      footer: { html: '' },
      terms: { html: '' },
      customNote: { html: '' },
    },
    sections: {
      seller: { visible: true, fields: { legalName: true, address: true, emirate: true, trn: true, tradeLicence: true } },
      buyer: { visible: true, fields: { name: true, email: true, address: true, phone: true } },
      meta: { visible: true, fields: {} },
      taxInfo: { visible: true, fields: {} },
      lineItems: {
        visible: true,
        columns: {
          description: true,
          quantity: true,
          unitPrice: documentType !== 'packing_slip',
          vatRate: documentType !== 'packing_slip',
          vatAmount: false,
          discount: documentType !== 'packing_slip',
          lineTotal: documentType !== 'packing_slip',
          sku: documentType === 'packing_slip',
          productTitle: true,
          productImage: false,
          barcode: false,
        },
      },
      totals: {
        visible: documentType !== 'packing_slip',
        showSubtotal: true,
        showDiscount: true,
        showVat: true,
        showShipping: true,
        showGrandTotal: true,
      },
      qrCode: { visible: documentType === 'tax_invoice' },
    },
    labels: {},
    language: { primary: 'en', showBilingual: false },
  });
  return buildLiquidFromConfig(config, documentType);
}

export function buildLiquidFromConfig(
  config: TemplateConfig,
  documentType: DocumentType,
  _baseLayoutCode?: BaseLayoutCode
): string {
  const showPrices = documentType !== 'packing_slip';
  const cols = config.sections.lineItems.columns;
  const totals = config.sections.totals;
  const branding = config.branding;
  const type = config.typography;
  const stacked = config.layout.sellerBuyerLayout === 'stacked';
  const logoCenter = config.layout.logoPosition === 'center';
  const headerStyle = config.layout.headerStyle;
  const showBuyer = config.sections.buyer.visible !== false;
  const showTrade = config.sections.seller.fields.tradeLicence !== false;
  const showTrn = config.sections.seller.fields.trn !== false;
  const showSku = cols.sku === true;
  const showProductTitle = cols.productTitle !== false;
  const showImage = cols.productImage === true;
  const showBarcode = cols.barcode === true;
  const showQty = cols.quantity !== false;
  const showUnit = showPrices && cols.unitPrice !== false;
  const showDiscount = showPrices && cols.discount !== false;
  const showVatCol = showPrices && cols.vatRate !== false;
  const showLineTotal = showPrices && cols.lineTotal !== false;
  const showTotals = showPrices && totals.visible !== false;
  const showQr = config.sections.qrCode?.visible === true;
  const showNotes = config.content.showNotes !== false;
  const showTerms = config.content.showTerms !== false;
  const headerBg =
    headerStyle === 'banner' ? branding.primaryColor : headerStyle === 'emirates' ? branding.primaryColor : 'transparent';
  const headerColor = headerStyle === 'minimal' ? branding.primaryColor : '#fff';
  const partiesCols = stacked ? '1fr' : '1fr 1fr';
  const headerAlign = logoCenter ? 'center' : 'space-between';
  const headerDir = logoCenter ? 'column' : 'row';

  const th: string[] = ['<th>Description</th>'];
  if (showQty) th.push('<th>Qty</th>');
  if (showUnit) th.push('<th class="num">Unit</th>');
  if (showDiscount) th.push('<th class="num">Disc</th>');
  if (showVatCol) th.push('<th class="num">VAT</th>');
  if (showLineTotal) th.push('<th class="num">Total</th>');

  const imageCell = showImage
    ? `{% if item.image_url %}<img class="thumb" src="{{ item.image_url }}" alt="" />{% endif %}\n            `
    : '';
  const td: string[] = [
    `<td>
            ${imageCell}${showProductTitle ? '{{ item.product_title | default: item.description }}' : '{{ item.description }}'}
            ${showSku ? `{% if item.sku %}<div class="sub">SKU {{ item.sku }}</div>{% endif %}` : ''}
            ${showBarcode ? `{% if item.barcode_data_url %}<img class="barcode" src="{{ item.barcode_data_url }}" alt="" />{% endif %}` : ''}
          </td>`,
  ];
  if (showQty) td.push('<td>{{ item.quantity }}</td>');
  if (showUnit) td.push('<td class="num">{{ item.unit_price }}</td>');
  if (showDiscount) td.push('<td class="num">{{ item.discount }}</td>');
  if (showVatCol) td.push('<td class="num">{{ item.vat_rate }}</td>');
  if (showLineTotal) td.push('<td class="num">{{ item.line_total }}</td>');

  const totalRows: string[] = [];
  if (totals.showSubtotal !== false) {
    totalRows.push('<div class="row"><span>{{ labels.subtotal }}</span><span>{{ totals.subtotal }}</span></div>');
  }
  if (totals.showDiscount !== false) {
    totalRows.push(
      '{% if totals.discount %}<div class="row"><span>{{ labels.discount }}</span><span>{{ totals.discount }}</span></div>{% endif %}'
    );
  }
  if (totals.showVat !== false) {
    totalRows.push('<div class="row"><span>{{ labels.vat }}</span><span>{{ totals.vat_total }}</span></div>');
  }
  if (totals.showShipping !== false) {
    totalRows.push(
      '{% if totals.shipping %}<div class="row"><span>{{ labels.shipping }}</span><span>{{ totals.shipping }}</span></div>{% endif %}'
    );
  }
  if (totals.showGrandTotal !== false) {
    totalRows.push(
      '<div class="row grand"><span>{{ labels.grand_total }}</span><span>{{ invoice.currency }} {{ totals.grand_total }}</span></div>'
    );
  }

  const stripe =
    headerStyle === 'emirates'
      ? `<div class="stripe" style="background:${branding.accentColor}"></div>`
      : '';

  const badge = config.layout.showTaxBadge
    ? '<div class="tax-badge">Tax registered supplier</div>'
    : '';

  const buyerBox = showBuyer
    ? `{% if buyer.name or buyer.email or buyer.phone or buyer.address %}
      <div class="box">
        <h3>{{ labels.buyer }}</h3>
        {% if buyer.name %}<div><strong>{{ buyer.name }}</strong></div>{% endif %}
        ${config.sections.buyer.fields.email !== false ? `{% if buyer.email %}<div>{{ buyer.email }}</div>{% endif %}` : ''}
        ${config.sections.buyer.fields.phone !== false ? `{% if buyer.phone %}<div>{{ buyer.phone }}</div>{% endif %}` : ''}
        ${config.sections.buyer.fields.address !== false ? `{% if buyer.address %}<div>{{ buyer.address }}</div>{% endif %}` : ''}
      </div>
      {% endif %}`
    : '';

  return `<!DOCTYPE html>
<html lang="{{ language.primary | default: "en" }}">
<head>
  <meta charset="UTF-8" />
  <title>{{ document.title_plain | default: document.title }}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111;
      background: #fff;
      font-family: ${type.fontFamily}, system-ui, sans-serif;
      font-size: ${type.baseFontSize}px;
    }
    .page { padding: 28px 32px; }
    .stripe { height: 8px; margin: -28px -32px 20px; }
    .header {
      display: flex;
      flex-direction: ${headerDir};
      justify-content: ${headerAlign};
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 24px;
      ${headerStyle === 'banner' ? `background: ${headerBg}; color: ${headerColor}; padding: 16px; border-radius: 8px;` : ''}
    }
    .logo { max-height: 56px; max-width: 180px; }
    h1 { margin: 0 0 4px; font-size: ${type.headingFontSize}px; color: ${headerColor}; font-weight: 400; }
    h1 p { margin: 0; }
    h1 strong, h1 b, .sub strong, .sub b, .footer strong, .footer b { font-weight: 700; }
    h1 em, h1 i, .sub em, .sub i, .footer em, .footer i { font-style: italic; }
    h1 u, .sub u, .footer u { text-decoration: underline; }
    .sub { color: ${headerStyle === 'minimal' ? '#64748b' : headerColor}; margin: 0; opacity: .9; font-weight: 400; }
    .sub p { margin: 0; }
    .meta { text-align: ${logoCenter ? 'center' : 'right'}; font-size: 12px; }
    .tax-badge { display: inline-block; margin-top: 8px; font-size: 10px; font-weight: 700; letter-spacing: .04em; color: ${branding.accentColor}; }
    .parties { display: grid; grid-template-columns: ${partiesCols}; gap: 16px; margin: 20px 0; }
    .box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
    .box h3 { margin: 0 0 8px; font-size: ${type.labelFontSize}px; letter-spacing: .04em; text-transform: uppercase; color: ${branding.secondaryColor}; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; font-size: ${type.labelFontSize}px; text-transform: uppercase; color: #64748b; padding: 8px 6px; border-bottom: 1px solid #e2e8f0; }
    td { padding: 8px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .thumb { max-height: 36px; max-width: 36px; margin-right: 8px; vertical-align: middle; }
    .barcode { display: block; height: 28px; margin-top: 4px; }
    .totals { margin-left: auto; width: 280px; margin-top: 16px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { margin-top: 8px; padding-top: 8px; border-top: 2px solid ${branding.primaryColor}; font-weight: 700; color: ${branding.accentColor}; }
    .footer { margin-top: 28px; color: #64748b; font-size: 12px; }
    .footer-label { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; color: ${branding.secondaryColor}; }
    .qr { margin-top: 16px; }
  </style>
  {{ custom_css }}
</head>
<body>
  <div class="page">
    ${stripe}
    <div class="header">
      <div>
        {% if branding.logo_url %}
          <img class="logo" src="{{ branding.logo_url }}" alt="Logo" />
        {% endif %}
        {% if content.title %}<h1>{{ content.title | default: document.title }}</h1>{% endif %}
        {% if content.subtitle %}<p class="sub">{{ content.subtitle }}</p>{% endif %}
        ${badge}
      </div>
      <div class="meta">
        {% if invoice.number %}<strong>{{ invoice.number }}</strong>{% endif %}
        {% if invoice.order_number %}<div>Order {{ invoice.order_number }}</div>{% endif %}
        {% if invoice.issue_date or invoice.currency %}
          <div>{% if invoice.issue_date %}{{ invoice.issue_date }}{% endif %}{% if invoice.issue_date and invoice.currency %} · {% endif %}{% if invoice.currency %}{{ invoice.currency }}{% endif %}</div>
        {% endif %}
        {% if invoice.original_number %}<div>Original {{ invoice.original_number }}</div>{% endif %}
      </div>
    </div>

    <div class="parties">
      <div class="box">
        <h3>{{ labels.seller }}</h3>
        {% if seller.legal_name %}<div><strong>{{ seller.legal_name }}</strong></div>{% endif %}
        ${showTrn ? `{% if seller.trn %}<div>{{ labels.trn }}: {{ seller.trn }}</div>{% endif %}` : ''}
        ${showTrade ? `{% if seller.trade_licence %}<div>Licence: {{ seller.trade_licence }}</div>{% endif %}` : ''}
        {% if seller.address_line %}<div>{{ seller.address_line }}</div>{% endif %}
      </div>
      ${buyerBox}
    </div>

    <table>
      <thead>
        <tr>
          ${th.join('\n          ')}
        </tr>
      </thead>
      <tbody>
        {% for item in line_items %}
        <tr>
          ${td.join('\n          ')}
        </tr>
        {% endfor %}
      </tbody>
    </table>

    ${
      showTotals
        ? `<div class="totals">
      ${totalRows.join('\n      ')}
    </div>`
        : ''
    }

    ${showNotes ? `{% if content.note %}
      <div class="footer"><div class="footer-label">Notes</div>{{ content.note }}</div>
    {% endif %}` : ''}
    ${showTerms ? `{% if content.terms %}
      <div class="footer"><div class="footer-label">Terms &amp; conditions</div>{{ content.terms }}</div>
    {% endif %}` : ''}
    {% if content.footer %}
      <div class="footer">{{ content.footer }}</div>
    {% endif %}
    ${showQr ? `{% if qr_html %}
      <div class="qr">{{ qr_html }}</div>
    {% endif %}` : ''}
  </div>
</body>
</html>
`;
}

export const LIQUID_VARIABLE_HELP = [
  { token: '{{ invoice.number }}', hint: 'Invoice / document number' },
  { token: '{{ invoice.order_number }}', hint: 'Shopify order name' },
  { token: '{{ invoice.issue_date }}', hint: 'Issue date' },
  { token: '{{ invoice.currency }}', hint: 'Currency code' },
  { token: '{{ seller.legal_name }}', hint: 'Seller legal name' },
  { token: '{{ seller.trn }}', hint: 'Seller TRN' },
  { token: '{{ seller.address_line }}', hint: 'Seller address' },
  { token: '{{ buyer.name }}', hint: 'Customer name' },
  { token: '{{ buyer.email }}', hint: 'Customer email' },
  { token: '{% for item in line_items %}', hint: 'Line items loop' },
  { token: '{{ item.description }}', hint: 'Line description' },
  { token: '{{ item.quantity }}', hint: 'Quantity' },
  { token: '{{ item.unit_price }}', hint: 'Unit price' },
  { token: '{{ item.line_total }}', hint: 'Line total' },
  { token: '{{ totals.vat_total }}', hint: 'VAT total' },
  { token: '{{ totals.grand_total }}', hint: 'Grand total' },
  { token: '{{ branding.primary_color }}', hint: 'Primary colour from Style' },
  { token: '{{ branding.logo_url }}', hint: 'Logo URL' },
  { token: '{{ qr_html }}', hint: 'Verification QR (HTML)' },
];
