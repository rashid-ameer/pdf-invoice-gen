import type { DocumentType } from "../types/index";
import type { ResolvedSocialLinks, StoreSocialLinksInput } from "./social-links.server";
import { resolveSocialLinks } from "./social-links.server";
import type { BaseLayoutCode, TemplateConfig } from "./template-config.types";
import { enforceComplianceLocks, templateConfigSchema } from "./template-config.types";
import { DEFAULT_AR_CONTENT, DEFAULT_AR_LABELS } from "./template-i18n";

const LAYOUT_THEMES: Record<
  BaseLayoutCode,
  { primary: string; secondary: string; accent: string; headerStyle: 'minimal' | 'banner' | 'emirates' }
> = {
  modern: {
    primary: '#008060',
    secondary: '#6d7175',
    accent: '#004c3f',
    headerStyle: 'minimal',
  },
  professional: {
    primary: '#1a365d',
    secondary: '#4a5568',
    accent: '#2c5282',
    headerStyle: 'banner',
  },
  emirates: {
    primary: '#007A3D',
    secondary: '#1f2933',
    accent: '#C5A572',
    headerStyle: 'emirates',
  },
  canvas: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#EA580C',
    headerStyle: 'minimal',
  },
  tide: {
    primary: '#3B82F6',
    secondary: '#6B7280',
    accent: '#2563EB',
    headerStyle: 'minimal',
  },
  folio: {
    primary: '#2563EB',
    secondary: '#6B7280',
    accent: '#1D4ED8',
    headerStyle: 'minimal',
  },
  bloom: {
    primary: '#E11D48',
    secondary: '#6B7280',
    accent: '#BE123C',
    headerStyle: 'minimal',
  },
  iris: {
    primary: '#7C3AED',
    secondary: '#6B7280',
    accent: '#6D28D9',
    headerStyle: 'minimal',
  },
  haze: {
    primary: '#5B21B6',
    secondary: '#6B7280',
    accent: '#D9F99D',
    headerStyle: 'minimal',
  },
  ledger: {
    primary: '#111111',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
  noir: {
    primary: '#111111',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
  slate: {
    primary: '#111111',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
  charter: {
    primary: '#1B2A4E',
    secondary: '#64748B',
    accent: '#1B2A4E',
    headerStyle: 'minimal',
  },
  matrix: {
    primary: '#1E3A5F',
    secondary: '#64748B',
    accent: '#D6EAF5',
    headerStyle: 'minimal',
  },
  ember: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#EA580C',
    headerStyle: 'minimal',
  },
  summit: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
  flare: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#EA580C',
    headerStyle: 'minimal',
  },
  vault: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
  beacon: {
    primary: '#F97316',
    secondary: '#6B7280',
    accent: '#EA580C',
    headerStyle: 'minimal',
  },
  onyx: {
    primary: '#111111',
    secondary: '#6B7280',
    accent: '#111111',
    headerStyle: 'minimal',
  },
};

function baseConfig(layout: BaseLayoutCode): TemplateConfig {
  const theme = LAYOUT_THEMES[layout];
  const storefront =
    layout === 'canvas' ||
    layout === 'tide' ||
    layout === 'folio' ||
    layout === 'bloom' ||
    layout === 'iris' ||
    layout === 'haze' ||
    layout === 'ledger' ||
    layout === 'noir' ||
    layout === 'slate' ||
    layout === 'charter' ||
    layout === 'matrix' ||
    layout === 'ember' ||
    layout === 'summit' ||
    layout === 'flare' ||
    layout === 'vault' ||
    layout === 'beacon' ||
    layout === 'onyx';
  return templateConfigSchema.parse({
    branding: {
      logoUrl: '',
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
    },
    typography: {
      fontFamily: layout === 'professional' ? 'Georgia' : storefront ? 'Inter' : 'Segoe UI',
      baseFontSize: 13,
      headingFontSize:
        layout === 'emirates'
          ? 32
          : layout === 'professional'
            ? 26
            : layout === 'haze' || layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon' || layout === 'onyx'
              ? 32
              : layout === 'folio' || layout === 'iris'
                ? 28
                : storefront
                  ? 22
                  : 28,
      labelFontSize: 11,
    },
    layout: {
      headerStyle: theme.headerStyle,
      sellerBuyerLayout: 'side-by-side',
      logoPosition: 'left',
      showTaxBadge: layout !== 'professional' && !storefront,
    },
    content: {
      documentTitle: {
        html:
          layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon' || layout === 'onyx'
            ? '<p>Invoice</p>'
            : layout === 'folio' || layout === 'iris' || layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix'
            ? '<p><strong>INVOICE</strong></p>'
            : layout === 'bloom' || layout === 'haze'
              ? '<p>Invoice</p>'
              : '<p><strong>TAX INVOICE</strong></p>',
      },
      subtitle: {
        html:
          layout === 'folio' || layout === 'bloom' || layout === 'iris' || layout === 'haze' || layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'onyx'
            ? ''
            : layout === 'beacon'
              ? '<p>Tax invoice</p>'
            : layout === 'professional'
              ? '<p>Tax compliant invoice format</p>'
              : storefront
                ? '<p>Tax invoice</p>'
                : '<p>Tax compliant</p>',
      },
      footer: {
        html:
          layout === 'beacon'
            ? '<p>Thank you!</p>'
            : layout === 'ledger' || layout === 'onyx'
              ? ''
              : '<p>Thank you for your business</p>',
      },
      terms: { html: '' },
      customNote: { html: '' },
    },
    sections: {
      seller: {
        visible: true,
        fields: {
          legalName: true,
          address: true,
          emirate: true,
          trn: true,
          tradeLicence: !storefront,
        },
      },
      buyer: {
        visible: true,
        fields: {
          name: true,
          email: layout === 'charter' ? true : !storefront,
          address: true,
          phone: layout === 'canvas' || layout === 'tide' || layout === 'bloom' || layout === 'iris' || layout === 'haze' || layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon',
        },
      },
      lineItems: {
        visible: true,
        columns: {
          description: true,
          quantity: layout !== 'haze',
          unitPrice: layout === 'flare' || layout === 'vault' ? false : layout !== 'haze',
          vatRate: true,
          vatAmount: false,
          discount: !storefront,
          lineTotal: true,
          sku: false,
          productTitle: layout !== 'slate',
          productImage: layout !== 'slate',
          barcode: layout !== 'slate' && !storefront,
        },
      },
      totals: {
        visible: true,
        showSubtotal: true,
        showDiscount: true,
        showVat: true,
        showShipping: layout === 'professional',
        showGrandTotal: true,
      },
      qrCode: { visible: true },
    },
    labels: {
      seller:
        layout === 'professional'
          ? 'Supplier'
          : layout === 'bloom' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon' || layout === 'onyx'
            ? 'From'
            : layout === 'emirates' || storefront
              ? 'From'
              : 'Seller',
      buyer:
        layout === 'professional'
          ? 'Customer'
          : layout === 'emirates' || layout === 'ledger'
            ? 'Bill To'
            : layout === 'noir' || layout === 'charter'
              ? 'Invoice To'
              : layout === 'slate'
                ? 'Bill To'
                : layout === 'bloom' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon' || layout === 'onyx'
              ? 'To'
              : storefront
                ? 'Billed to'
                : 'Buyer',
      invoiceNumber:
        layout === 'flare' || layout === 'vault' || layout === 'beacon' || layout === 'onyx'
          ? 'Invoice No'
          : layout === 'ember' || layout === 'summit'
            ? 'No.'
            : layout === 'charter'
            ? 'Invoice No.'
            : layout === 'folio'
              ? 'Invoice #'
              : storefront
                ? 'Invoice number'
                : 'Invoice Number',
      orderNumber: storefront ? 'Reference' : 'Order Number',
      issueDate:
        layout === 'onyx'
          ? 'Issue date'
          : layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon'
            ? 'Date'
          : layout === 'charter'
            ? 'Invoice Date'
            : layout === 'iris'
              ? 'Issued'
              : layout === 'bloom'
                ? 'Date'
                : storefront
                  ? 'Invoice date'
                  : 'Issue Date',
      shippingMethod: 'Shipping Method',
      orderNote: 'Order Note',
      subtotal: layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix' ? (layout === 'matrix' ? 'Net Total' : 'Sub Total') : 'Subtotal',
      discount: 'Discount',
      vatTotal: layout === 'ledger' || layout === 'noir' || layout === 'slate' || layout === 'charter' || layout === 'matrix' ? 'Tax' : 'VAT Total',
      shipping: 'Shipping',
      grandTotal:
        layout === 'onyx'
          ? 'Invoice total'
          : layout === 'bloom' || layout === 'iris' || layout === 'haze'
          ? 'Amount due'
          : layout === 'tide' || layout === 'folio'
            ? 'Total due'
            : layout === 'canvas' || layout === 'ember' || layout === 'summit' || layout === 'flare' || layout === 'vault' || layout === 'beacon'
              ? 'Total'
              : 'Grand Total',
      trn: 'TRN',
      tradeLicence: layout === 'professional' ? 'Licence' : 'Trade Licence',
      dueDate: 'Due date',
    },
    language: {
      primary: 'en',
      showBilingual: false,
    },
    translations: {
      documentTitle: { html: DEFAULT_AR_CONTENT.documentTitle },
      subtitle: { html: DEFAULT_AR_CONTENT.subtitle },
      footer: { html: DEFAULT_AR_CONTENT.footer },
      labels: { ...DEFAULT_AR_LABELS },
    },
  });
}

function packingSlipBaseConfig(layout: BaseLayoutCode = 'modern'): TemplateConfig {
  const theme = LAYOUT_THEMES[layout];
  return templateConfigSchema.parse({
    branding: {
      logoUrl: '',
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
    },
    typography: {
      fontFamily: 'Segoe UI',
      baseFontSize: 13,
      headingFontSize: 26,
      labelFontSize: 11,
    },
    layout: {
      headerStyle: 'minimal',
      sellerBuyerLayout: 'side-by-side',
      logoPosition: 'left',
      showTaxBadge: false,
    },
    content: {
      documentTitle: { html: '<p><strong>PACKING SLIP</strong></p>' },
      subtitle: { html: '<p>Please verify items before sealing the package</p>' },
      footer: { html: '<p>Thank you for your order</p>' },
      terms: { html: '' },
      customNote: { html: '' },
    },
    sections: {
      seller: {
        visible: true,
        fields: {
          legalName: true,
          address: true,
          emirate: true,
          trn: false,
          tradeLicence: false,
        },
      },
      buyer: {
        visible: true,
        fields: { name: true, email: false, address: true },
      },
      lineItems: {
        visible: true,
        columns: {
          description: true,
          quantity: true,
          unitPrice: false,
          vatRate: false,
          vatAmount: false,
          discount: false,
          lineTotal: false,
          sku: true,
          productTitle: true,
          productImage: false,
          barcode: false,
        },
      },
      totals: {
        visible: false,
        showSubtotal: false,
        showDiscount: false,
        showVat: false,
        showShipping: false,
        showGrandTotal: false,
      },
      qrCode: { visible: false },
    },
    labels: {
      seller: 'From',
      buyer: 'Ship To',
      invoiceNumber: 'Invoice',
      orderNumber: 'Order Number',
      issueDate: 'Date',
      shippingMethod: 'Shipping Method',
      orderNote: 'Notes',
      subtotal: 'Subtotal',
      discount: 'Discount',
      vatTotal: 'VAT Total',
      shipping: 'Shipping',
      grandTotal: 'Grand Total',
      trn: 'TRN',
      tradeLicence: 'Trade Licence',
    },
    language: {
      primary: 'en',
      showBilingual: false,
    },
    translations: {
      documentTitle: { html: '<p><strong>قائمة التعبئة</strong></p>' },
      subtitle: { html: '<p>يرجى التحقق من المنتجات قبل إغلاق الطرد</p>' },
      footer: { html: '<p>شكراً لطلبكم</p>' },
      labels: {
        ...DEFAULT_AR_LABELS,
        seller: 'من',
        buyer: 'الشحن إلى',
        orderNumber: 'رقم الطلب',
        shippingMethod: 'طريقة الشحن',
        orderNote: 'ملاحظات',
      },
    },
  });
}

function creditNoteBaseConfig(layout: BaseLayoutCode = 'modern'): TemplateConfig {
  const theme = LAYOUT_THEMES[layout];
  return templateConfigSchema.parse({
    branding: {
      logoUrl: '',
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
    },
    typography: {
      fontFamily: layout === 'professional' ? 'Georgia' : 'Segoe UI',
      baseFontSize: 13,
      headingFontSize: layout === 'emirates' ? 30 : 26,
      labelFontSize: 11,
    },
    layout: {
      headerStyle: theme.headerStyle,
      sellerBuyerLayout: 'side-by-side',
      logoPosition: 'left',
      showTaxBadge: true,
    },
    content: {
      documentTitle: { html: '<p><strong>CREDIT NOTE</strong></p>' },
      subtitle: { html: '<p>Adjustment for returned or refunded goods</p>' },
      footer: { html: '<p>This credit note adjusts the original tax invoice</p>' },
      terms: { html: '' },
      customNote: { html: '' },
    },
    sections: {
      seller: {
        visible: true,
        fields: {
          legalName: true,
          address: true,
          emirate: true,
          trn: true,
          tradeLicence: true,
        },
      },
      buyer: {
        visible: true,
        fields: { name: true, email: true, address: true },
      },
      lineItems: {
        visible: true,
        columns: {
          description: true,
          quantity: true,
          unitPrice: true,
          vatRate: true,
          vatAmount: false,
          discount: true,
          lineTotal: true,
          sku: true,
          productTitle: true,
          productImage: true,
          barcode: true,
        },
      },
      totals: {
        visible: true,
        showSubtotal: true,
        showDiscount: true,
        showVat: true,
        showShipping: false,
        showGrandTotal: true,
      },
      qrCode: { visible: true },
    },
    labels: {
      seller: 'Seller',
      buyer: 'Buyer',
      invoiceNumber: 'Credit Note',
      orderNumber: 'Order Number',
      issueDate: 'Issue Date',
      shippingMethod: 'Shipping Method',
      orderNote: 'Order Note',
      originalInvoice: 'Original Invoice',
      reason: 'Reason',
      creditNoteNumber: 'Credit Note Number',
      subtotal: 'Subtotal',
      discount: 'Discount',
      vatTotal: 'VAT Total',
      shipping: 'Shipping',
      grandTotal: 'Credit Total',
      trn: 'TRN',
      tradeLicence: 'Trade Licence',
    },
    language: {
      primary: 'en',
      showBilingual: false,
    },
    translations: {
      documentTitle: { html: '<p><strong>إشعار دائن</strong></p>' },
      subtitle: { html: '<p>تعديل للبضائع المرتجعة أو المستردة · ضريبة القيمة المضافة في الإمارات</p>' },
      footer: { html: '<p>يقوم إشعار الدائن هذا بتعديل الفاتورة الضريبية الأصلية</p>' },
      labels: {
        ...DEFAULT_AR_LABELS,
        invoiceNumber: 'إشعار دائن',
        originalInvoice: 'الفاتورة الأصلية',
        reason: 'السبب',
        creditNoteNumber: 'رقم إشعار الدائن',
        grandTotal: 'إجمالي الائتمان',
      },
    },
  });
}

function refundDocumentBaseConfig(layout: BaseLayoutCode = 'modern'): TemplateConfig {
  const theme = LAYOUT_THEMES[layout];
  return templateConfigSchema.parse({
    branding: {
      logoUrl: '',
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
    },
    typography: {
      fontFamily: layout === 'professional' ? 'Georgia' : 'Segoe UI',
      baseFontSize: 13,
      headingFontSize: layout === 'emirates' ? 28 : 26,
      labelFontSize: 11,
    },
    layout: {
      headerStyle: theme.headerStyle,
      sellerBuyerLayout: 'side-by-side',
      logoPosition: 'left',
      showTaxBadge: false,
    },
    content: {
      documentTitle: { html: '<p><strong>REFUND DOCUMENT</strong></p>' },
      subtitle: {
        html: '<p>Record of refunded amounts and related order items for customers and accounting</p>',
      },
      footer: { html: '<p>Thank you — this document confirms the refund processed for your order</p>' },
      terms: { html: '' },
      customNote: { html: '' },
    },
    sections: {
      seller: {
        visible: true,
        fields: {
          legalName: true,
          address: true,
          emirate: true,
          trn: false,
          tradeLicence: false,
        },
      },
      buyer: {
        visible: true,
        fields: { name: true, email: true, address: true },
      },
      lineItems: {
        visible: true,
        columns: {
          description: true,
          quantity: true,
          unitPrice: true,
          vatRate: false,
          vatAmount: false,
          discount: false,
          lineTotal: true,
          sku: true,
          productTitle: true,
          productImage: true,
          barcode: true,
        },
      },
      totals: {
        visible: true,
        showSubtotal: true,
        showDiscount: false,
        showVat: false,
        showShipping: false,
        showGrandTotal: true,
      },
      qrCode: { visible: true },
    },
    labels: {
      seller: 'From',
      buyer: 'Customer',
      invoiceNumber: 'Refund Document',
      orderNumber: 'Order Number',
      issueDate: 'Refund Date',
      shippingMethod: 'Shipping Method',
      orderNote: 'Notes',
      originalInvoice: 'Original Invoice',
      reason: 'Refund Reason',
      creditNoteNumber: 'Credit Note Number',
      refundDocumentNumber: 'Refund Document',
      subtotal: 'Subtotal',
      discount: 'Discount',
      vatTotal: 'VAT Total',
      shipping: 'Shipping',
      grandTotal: 'Refund Total',
      trn: 'TRN',
      tradeLicence: 'Trade Licence',
    },
    language: {
      primary: 'en',
      showBilingual: false,
    },
    translations: {
      documentTitle: { html: '<p><strong>وثيقة استرداد</strong></p>' },
      subtitle: {
        html: '<p>سجل بالمبالغ المستردة وعناصر الطلب ذات الصلة للعملاء والمحاسبة</p>',
      },
      footer: { html: '<p>شكراً — تؤكد هذه الوثيقة معالجة الاسترداد لطلبك</p>' },
      labels: {
        ...DEFAULT_AR_LABELS,
        seller: 'من',
        buyer: 'العميل',
        invoiceNumber: 'وثيقة استرداد',
        orderNumber: 'رقم الطلب',
        issueDate: 'تاريخ الاسترداد',
        originalInvoice: 'الفاتورة الأصلية',
        reason: 'سبب الاسترداد',
        refundDocumentNumber: 'وثيقة استرداد',
        grandTotal: 'إجمالي الاسترداد',
      },
    },
  });
}

export function getDefaultConfigForLayout(
  layout: BaseLayoutCode,
  documentType: DocumentType = 'tax_invoice'
): TemplateConfig {
  if (documentType === 'packing_slip') {
    return enforceComplianceLocks(packingSlipBaseConfig(layout), 'packing_slip');
  }
  if (documentType === 'credit_note') {
    return enforceComplianceLocks(creditNoteBaseConfig(layout), 'credit_note');
  }
  if (documentType === 'refund_document') {
    return enforceComplianceLocks(refundDocumentBaseConfig(layout), 'refund_document');
  }
  return enforceComplianceLocks(baseConfig(layout), documentType);
}

export function mergeConfigWithBranding(
  config: TemplateConfig,
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    footerText?: string;
    socialLinks?: ResolvedSocialLinks | StoreSocialLinksInput;
  } | null,
  documentType: DocumentType = 'tax_invoice'
): TemplateConfig {
  if (!branding) return config;

  const merged = structuredClone(config);
  if (branding.logoUrl) merged.branding.logoUrl = branding.logoUrl;
  if (branding.primaryColor) merged.branding.primaryColor = branding.primaryColor;
  if (branding.secondaryColor) merged.branding.secondaryColor = branding.secondaryColor;
  if (branding.accentColor) merged.branding.accentColor = branding.accentColor;
  if (branding.footerText && documentType !== 'packing_slip') {
    merged.content.footer = { html: `<p>${escapeForRichText(branding.footerText)}</p>` };
  }
  if (branding.socialLinks && documentType !== 'packing_slip') {
    const resolved =
      'links' in branding.socialLinks && Array.isArray(branding.socialLinks.links)
        ? branding.socialLinks
        : resolveSocialLinks(branding.socialLinks as StoreSocialLinksInput);
    merged.socialLinks = {
      visible: resolved.visible,
      links: resolved.links.map((link) => ({ ...link })),
    };
  }
  return enforceComplianceLocks(merged, documentType);
}

function escapeForRichText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const SAMPLE_INVOICE_DATA = {
  invoiceNumber: 'INV-00042',
  orderNumber: '#1042',
  issueDate: '21 Jul 2026',
  dueDate: '4 Aug 2026',
  currency: 'USD',
  shippingMethod: 'Aramex Express',
  orderNote: '',
  seller: {
    legalName: 'Acme Trading Ltd',
    tradeName: 'Acme Trading',
    trn: 'GB123456789',
    tin: '1234567890',
    tradeLicence: 'REG-123456',
    businessEmail: 'billing@acme.example',
    businessPhone: '+1 555 0100',
    address: { line1: '100 Commerce Street', city: 'London', emirate: 'England', country: 'GB' },
  },
  buyer: {
    name: 'Jane Customer',
    email: 'jane@example.com',
    phone: '+1 555 0199',
    addressLine: '42 Market Road, London, England, SW1A 1AA, GB',
  },
  lineItems: [
    {
      description: 'Premium Widget — Large / Blue',
      productTitle: 'Premium Widget',
      variantTitle: 'Large / Blue',
      imageUrl:
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiNlZWYyZjEiLz48cGF0aCBkPSJNMTggNDJsMTAtMTIgMTAgOCA4LTEwIiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==',
      barcode: '6291108734612',
      quantity: 2,
      unitPrice: '150.00',
      discount: '10%',
      vatRate: '5%',
      vatAmount: '13.50',
      lineTotal: '283.50',
      sku: 'WDG-001',
    },
    {
      description: 'Express Shipping',
      productTitle: 'Express Shipping',
      barcode: 'SHIP-EXP-001',
      quantity: 1,
      unitPrice: '25.00',
      discount: '0%',
      vatRate: '5%',
      vatAmount: '1.25',
      lineTotal: '26.25',
      sku: 'SHIP',
    },
  ],
  totals: {
    subtotal: '295.00',
    discount: '30.00',
    vatTotal: '14.75',
    shipping: '0.00',
    grandTotal: '309.75',
    totalWithoutTax: '295.00',
    amountDue: '309.75',
  },
};

export const SAMPLE_PACKING_SLIP_DATA = {
  ...SAMPLE_INVOICE_DATA,
  invoiceNumber: 'INV-00042',
  orderNumber: '#1042',
  shippingMethod: 'Aramex Express',
  orderNote: 'Leave at reception if unavailable',
  buyer: {
    name: 'Ahmed Al Mansoori',
    email: 'ahmed@example.ae',
    phone: '+971 50 123 4567',
    addressLine: 'Marina Walk, Apt 1204, Dubai, Dubai, 00000, AE',
  },
  lineItems: [
    {
      description: 'Premium Widget — Large / Blue',
      quantity: 2,
      unitPrice: '150.00',
      discount: '10%',
      vatRate: '5%',
      vatAmount: '13.50',
      lineTotal: '283.50',
      sku: 'WDG-001',
    },
    {
      description: 'Ceramic Mug — White',
      quantity: 1,
      unitPrice: '45.00',
      discount: '0%',
      vatRate: '5%',
      vatAmount: '2.25',
      lineTotal: '47.25',
      sku: 'MUG-WHT',
    },
  ],
};

export const SAMPLE_CREDIT_NOTE_DATA = {
  ...SAMPLE_INVOICE_DATA,
  invoiceNumber: 'CN-00007',
  orderNumber: '#1042',
  originalInvoiceNumber: 'INV-00042',
  reason: 'Customer returned 1 item — defective',
  lineItems: [
    {
      description: 'Premium Widget — Large / Blue',
      quantity: 1,
      unitPrice: '150.00',
      discount: '0%',
      vatRate: '5%',
      vatAmount: '7.50',
      lineTotal: '157.50',
      sku: 'WDG-001',
    },
  ],
  totals: {
    subtotal: '150.00',
    discount: '0.00',
    vatTotal: '7.50',
    shipping: '0.00',
    grandTotal: '157.50',
  },
};

export const SAMPLE_REFUND_DOCUMENT_DATA = {
  ...SAMPLE_CREDIT_NOTE_DATA,
  invoiceNumber: 'CN-00007',
  reason: 'Order canceled — full refund',
};
