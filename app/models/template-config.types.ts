import { z } from "zod";

import type { DocumentType } from "../types/index";

export const FONT_FAMILIES = [
  'Inter',
  'Segoe UI',
  'Georgia',
  'Arial',
  'Times New Roman',
] as const;

export const BASE_LAYOUT_CODES = ['modern', 'professional', 'emirates', 'canvas', 'tide', 'folio', 'bloom', 'iris', 'haze', 'ledger', 'noir', 'slate', 'charter', 'matrix', 'ember', 'summit', 'flare', 'vault', 'beacon', 'onyx'] as const;
export type BaseLayoutCode = (typeof BASE_LAYOUT_CODES)[number];

export const FIXED_SLOT_LAYOUTS: readonly BaseLayoutCode[] = ['canvas', 'tide', 'folio', 'bloom', 'iris', 'haze', 'ledger', 'noir', 'slate', 'charter', 'matrix', 'ember', 'summit', 'flare', 'vault', 'beacon', 'onyx'];

export type LayoutEditorCapabilities = {
  headerStyle: boolean;
  sellerBuyerLayout: boolean;
  logoPosition: boolean;
  taxBadge: boolean;
  codeEditor: boolean;
  documentTitle: boolean;
  documentSubtitle: boolean;
  extraColors: boolean;
  productDisplay: boolean;
  qrCode: boolean;
  sellerLabel: boolean;
};

/** Which editor controls this layout actually honours. False = hide; the renderer ignores them. */
export function layoutEditorCapabilities(code: BaseLayoutCode): LayoutEditorCapabilities {
  const fixed = (FIXED_SLOT_LAYOUTS as readonly string[]).includes(code);
  const compact = code === 'tide' || code === 'folio' || code === 'bloom' || code === 'iris' || code === 'haze' || code === 'ledger' || code === 'noir' || code === 'slate' || code === 'charter' || code === 'matrix' || code === 'ember' || code === 'summit' || code === 'flare' || code === 'vault' || code === 'beacon' || code === 'onyx';
  return {
    headerStyle: !fixed,
    sellerBuyerLayout: !fixed,
    logoPosition: !fixed,
    taxBadge: !fixed,
    codeEditor: !fixed,
    documentTitle: code !== 'tide',
    documentSubtitle: code === 'summit' || code === 'flare' || code === 'vault' || code === 'beacon' || !compact,
    extraColors: code === 'haze' || code === 'matrix' || code === 'summit' || code === 'vault' || !compact,
    productDisplay: code !== 'slate',
    qrCode: true,
    sellerLabel: code !== 'tide' && code !== 'folio' && code !== 'haze' && code !== 'ledger' && code !== 'noir' && code !== 'slate' && code !== 'charter' && code !== 'matrix' && code !== 'ember' && code !== 'summit' && code !== 'flare' && code !== 'vault' && code !== 'beacon' && code !== 'onyx',
  };
}

/** Clamp config fields the layout renderer does not honour (avoids no-op editor toggles). */
export function applyLayoutCapabilityLocks(
  config: TemplateConfig,
  baseLayoutCode: BaseLayoutCode
): TemplateConfig {
  const caps = layoutEditorCapabilities(baseLayoutCode);
  const locked = structuredClone(config);
  if (!caps.productDisplay) {
    locked.sections.lineItems.columns.productImage = false;
    locked.sections.lineItems.columns.barcode = false;
    locked.sections.lineItems.columns.productTitle = false;
  }
  if (baseLayoutCode === 'matrix') {
    const { primaryColor, accentColor } = locked.branding;
    const accent = (accentColor || '').trim().toLowerCase();
    const primary = (primaryColor || '').trim().toLowerCase();
    if (!accent || accent === primary) {
      locked.branding.accentColor = '#D6EAF5';
    }
  }
  if (baseLayoutCode === 'summit') {
    const { primaryColor, accentColor } = locked.branding;
    const accent = (accentColor || '').trim().toLowerCase();
    const primary = (primaryColor || '').trim().toLowerCase();
    if (!accent || accent === primary) {
      locked.branding.accentColor = '#111111';
    }
  }
  if (baseLayoutCode === 'flare' || baseLayoutCode === 'vault') {
    locked.sections.lineItems.columns.unitPrice = false;
  }
  if (baseLayoutCode === 'vault') {
    const { primaryColor, accentColor } = locked.branding;
    const accent = (accentColor || '').trim().toLowerCase();
    const primary = (primaryColor || '').trim().toLowerCase();
    if (!accent || accent === primary) {
      locked.branding.accentColor = '#111111';
    }
  }
  return locked;
}

export const DOCUMENT_TYPES = ['tax_invoice', 'credit_note', 'packing_slip', 'refund_document'] as const;
export type { DocumentType };

export const richTextContentSchema = z.object({
  html: z.string().max(5000).default(''),
});

export const sectionConfigSchema = z.object({
  visible: z.boolean().default(true),
  fields: z.record(z.string(), z.boolean()).default({}),
});

export const lineItemsConfigSchema = z.object({
  visible: z.boolean().default(true),
  columns: z
    .object({
      description: z.boolean().default(true),
      quantity: z.boolean().default(true),
      unitPrice: z.boolean().default(true),
      vatRate: z.boolean().default(true),
      vatAmount: z.boolean().default(false),
      discount: z.boolean().default(true),
      lineTotal: z.boolean().default(true),
      sku: z.boolean().default(false),
      productTitle: z.boolean().default(true),
      productImage: z.boolean().default(true),
      barcode: z.boolean().default(true),
    })
    .default({}),
});

export const totalsConfigSchema = z.object({
  visible: z.boolean().default(true),
  showSubtotal: z.boolean().default(true),
  showDiscount: z.boolean().default(true),
  showVat: z.boolean().default(true),
  showShipping: z.boolean().default(true),
  showGrandTotal: z.boolean().default(true),
});

export const socialLinkEntrySchema = z.object({
  platform: z.enum(['website', 'instagram', 'x', 'facebook', 'linkedin', 'tiktok', 'youtube']),
  label: z.string().max(40).default(''),
  url: z.string().max(500).default(''),
});

export const socialLinksConfigSchema = z.object({
  visible: z.boolean().default(false),
  links: z.array(socialLinkEntrySchema).default([]),
});

export const templateConfigSchema = z.object({
  branding: z.object({
    logoUrl: z.string().default(''),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#008060'),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6d7175'),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#004c3f'),
  }),
  typography: z.object({
    fontFamily: z.enum(FONT_FAMILIES).default('Segoe UI'),
    baseFontSize: z.number().min(10).max(14).default(13),
    headingFontSize: z.number().min(18).max(32).default(28),
    labelFontSize: z.number().min(9).max(12).default(11),
  }),
  layout: z.object({
    headerStyle: z.enum(['minimal', 'banner', 'emirates']).default('minimal'),
    sellerBuyerLayout: z.enum(['side-by-side', 'stacked']).default('side-by-side'),
    logoPosition: z.enum(['left', 'center']).default('left'),
    showTaxBadge: z.boolean().default(true),
  }),
  content: z.object({
    documentTitle: richTextContentSchema.default({ html: '<p><strong>TAX INVOICE</strong></p>' }),
    subtitle: richTextContentSchema.default({ html: '<p>Tax compliant</p>' }),
    footer: richTextContentSchema.default({ html: '<p>Thank you for your business</p>' }),
    terms: richTextContentSchema.default({ html: '' }),
    customNote: richTextContentSchema.default({ html: '' }),
    showTerms: z.boolean().default(true),
    showNotes: z.boolean().default(true),
  }),
  sections: z.object({
    seller: sectionConfigSchema.default({
      visible: true,
      fields: {
        legalName: true,
        tradeName: false,
        address: true,
        emirate: true,
        trn: true,
        tin: false,
        tradeLicence: true,
        businessEmail: false,
        businessPhone: false,
      },
    }),
    buyer: sectionConfigSchema.default({
      visible: true,
      fields: {
        name: true,
        email: true,
        address: true,
        phone: true,
        trn: false,
        tin: false,
      },
    }),
    meta: sectionConfigSchema.default({
      visible: true,
      fields: {
        invoice_number: true,
        order_number: true,
        issue_date: true,
        due_date: true,
        currency: true,
      },
    }),
    taxInfo: sectionConfigSchema.default({
      visible: true,
      fields: {
        seller_trn: true,
        seller_legal_name: true,
        seller_emirate: true,
      },
    }),
    lineItems: lineItemsConfigSchema.default({}),
    totals: totalsConfigSchema.default({}),
    qrCode: z.object({ visible: z.boolean().default(false) }).default({ visible: false }),
  }),
  labels: z
    .record(z.string(), z.string())
    .default({
      seller: 'Seller',
      buyer: 'Buyer',
      invoiceNumber: 'Invoice Number',
      orderNumber: 'Order Number',
      issueDate: 'Issue Date',
      shippingMethod: 'Shipping Method',
      orderNote: 'Order Note',
      originalInvoice: 'Original Invoice',
      reason: 'Reason',
      creditNoteNumber: 'Credit Note Number',
      refundDocumentNumber: 'Refund Document',
      subtotal: 'Subtotal',
      discount: 'Discount',
      vatTotal: 'VAT Total',
      shipping: 'Shipping',
      grandTotal: 'Grand Total',
      trn: 'Tax ID',
      tin: 'TIN',
      emirate: 'State / region',
      tradeLicence: 'Business registration',
      businessEmail: 'Email',
      businessPhone: 'Phone',
    }),
  language: z
    .object({
      primary: z.enum(['en', 'ar']).default('en'),
      showBilingual: z.boolean().default(false),
    })
    .default({ primary: 'en', showBilingual: false }),
  translations: z
    .object({
      documentTitle: richTextContentSchema.default({ html: '<p><strong>فاتورة ضريبية</strong></p>' }),
      subtitle: richTextContentSchema.default({ html: '<p>متوافق مع ضريبة القيمة المضافة في الإمارات</p>' }),
      footer: richTextContentSchema.default({ html: '<p>شكراً لتعاملكم معنا</p>' }),
      labels: z.record(z.string(), z.string()).default({}),
    })
    .default({}),
  socialLinks: socialLinksConfigSchema.default({ visible: false, links: [] }),
});

export type RichTextContent = z.infer<typeof richTextContentSchema>;
export type SectionConfig = z.infer<typeof sectionConfigSchema>;
export type LineItemsConfig = z.infer<typeof lineItemsConfigSchema>;
export type TotalsConfig = z.infer<typeof totalsConfigSchema>;
export type TemplateConfig = z.infer<typeof templateConfigSchema>;

export function parseTemplateConfig(input: unknown): TemplateConfig {
  const raw =
    input && typeof input === 'object'
      ? { ...(input as object), layout: { ...((input as { layout?: object }).layout ?? {}) } }
      : {};
  const layout = (raw as { layout?: Record<string, unknown> }).layout;
  if (layout && layout.showTaxBadge === undefined && layout.showUaeBadge !== undefined) {
    layout.showTaxBadge = layout.showUaeBadge;
    delete layout.showUaeBadge;
  }
  return templateConfigSchema.parse(raw);
}

export function parseTemplateConfigPartial(input: unknown): TemplateConfig {
  const defaults = templateConfigSchema.parse({});
  return templateConfigSchema.parse({ ...defaults, ...(input as object) });
}

export type ComplianceLockOptions = {
  /** Compliance e-invoice mode: hide merchandising columns, force VAT amount and seller IDs. */
  pintStrict?: boolean;
};

/**
 * Enforce tax-invoice compliance locks.
 * Packing slips and refund documents skip tax locks (warehouse / customer receipt use).
 * Pass `pintStrict: true` for compliance / structured e-invoice mode (ASP submission path).
 */
export function enforceComplianceLocks(
  config: TemplateConfig,
  documentType: DocumentType = 'tax_invoice',
  options: ComplianceLockOptions = {}
): TemplateConfig {
  const locked = structuredClone(config);

  if (documentType === 'packing_slip') {
    locked.sections.lineItems.visible = true;
    locked.sections.lineItems.columns.description = true;
    locked.sections.lineItems.columns.quantity = true;
    if (!locked.content.documentTitle.html.trim()) {
      locked.content.documentTitle = { html: '<p><strong>PACKING SLIP</strong></p>' };
    }
    return locked;
  }

  if (documentType === 'refund_document') {
    locked.sections.lineItems.visible = true;
    locked.sections.lineItems.columns.description = true;
    locked.sections.lineItems.columns.quantity = true;
    locked.sections.totals.visible = true;
    locked.sections.totals.showGrandTotal = true;
    if (!locked.content.documentTitle.html.trim()) {
      locked.content.documentTitle = { html: '<p><strong>REFUND DOCUMENT</strong></p>' };
    }
    return locked;
  }

  locked.sections.seller.visible = true;
  locked.sections.seller.fields.legalName = true;
  locked.sections.seller.fields.trn = true;
  locked.sections.seller.fields.emirate = true;

  locked.sections.lineItems.visible = true;
  locked.sections.lineItems.columns.description = true;
  locked.sections.lineItems.columns.vatRate = true;

  locked.sections.totals.visible = true;
  locked.sections.totals.showVat = true;
  locked.sections.totals.showGrandTotal = true;

  if (options.pintStrict) {
    locked.sections.seller.fields.address = true;
    locked.sections.seller.fields.tin = true;
    locked.sections.seller.fields.businessEmail = true;

    locked.sections.lineItems.columns.quantity = true;
    locked.sections.lineItems.columns.unitPrice = true;
    locked.sections.lineItems.columns.vatAmount = true;
    locked.sections.lineItems.columns.lineTotal = true;
    locked.sections.lineItems.columns.discount = false;
    locked.sections.lineItems.columns.sku = false;
    locked.sections.lineItems.columns.barcode = false;
    locked.sections.lineItems.columns.productImage = false;
    locked.sections.lineItems.columns.productTitle = false;

    if (locked.sections.meta) {
      locked.sections.meta.fields.currency = true;
      locked.sections.meta.fields.due_date = true;
    }
  }

  if (locked.sections.meta) {
    locked.sections.meta.fields.invoice_number = true;
    locked.sections.meta.fields.issue_date = true;
  }
  if (locked.sections.taxInfo) {
    locked.sections.taxInfo.fields.seller_trn = true;
  }

  if (!locked.content.documentTitle.html.trim()) {
    locked.content.documentTitle = {
      html:
        documentType === 'credit_note'
          ? '<p><strong>CREDIT NOTE</strong></p>'
          : '<p><strong>TAX INVOICE</strong></p>',
    };
  }

  return locked;
}
