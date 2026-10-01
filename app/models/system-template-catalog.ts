import type { DocumentType } from "../types/index";
import type { BaseLayoutCode } from "./template-config.types";

export interface SystemTemplateDefinition {
  code: string;
  name: string;
  description: string;
  htmlPath: string;
  baseLayoutCode: BaseLayoutCode;
  documentType: DocumentType;
  theme: { primary: string; accent: string; secondary: string };
  tags: string[];
}

interface LayoutTemplateSeed {
  code: BaseLayoutCode;
  name: string;
  description: string;
  htmlPath: string;
  theme: { primary: string; accent: string; secondary: string };
  tags: string[];
}

interface DocumentTypeVariant {
  documentType: DocumentType;
  codePrefix: string;
  modernCode: string;
  modernName: string;
  modernDescription: string;
  nameSuffix: string;
  descriptionTail: string;
  extraTags: string[];
}

const HTML_PATH = 'server/templates/modern/template.html';

const INVOICE_LAYOUT_TEMPLATES: LayoutTemplateSeed[] = [
  {
    code: 'modern',
    name: 'Modern Minimal',
    description:
      'Clean contemporary layout with clear TRN and VAT breakdown — ideal for D2C brands.',
    htmlPath: HTML_PATH,
    theme: { primary: '#008060', accent: '#004c3f', secondary: '#6d7175' },
    tags: ['TRN block', 'VAT column', 'Multi-currency', 'Logo support'],
  },
  {
    code: 'professional',
    name: 'Professional B2B',
    description:
      'Formal tax invoice with detailed supplier/customer panels for wholesale and B2B.',
    htmlPath: 'server/templates/professional/template.html',
    theme: { primary: '#1a365d', accent: '#2c5282', secondary: '#4a5568' },
    tags: ['Tax summary', 'Trade licence', 'B2B'],
  },
  {
    code: 'emirates',
    name: 'Classic Stripe',
    description:
      'Bold stripe header with bilingual-friendly layout, prominent tax ID strip, and accent colors.',
    htmlPath: 'server/templates/emirates/template.html',
    theme: { primary: '#007A3D', accent: '#C5A572', secondary: '#1f2933' },
    tags: ['Stripe header', 'Tax ID highlight', 'Bilingual-friendly', 'ASP ready'],
  },
  {
    code: 'canvas',
    name: 'Canvas',
    description:
      'Soft gray canvas with a white billing card, orange brand, and a hero total — built for D2C storefronts.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#EA580C', secondary: '#6B7280' },
    tags: ['Hero total', 'Billing card', 'D2C', 'Logo support'],
  },
  {
    code: 'tide',
    name: 'Tide',
    description:
      'Light-blue amount column, date chip, and a total-due bar — a clean D2C billing layout.',
    htmlPath: HTML_PATH,
    theme: { primary: '#3B82F6', accent: '#2563EB', secondary: '#6B7280' },
    tags: ['Total due', 'Date chip', 'D2C', 'Logo support'],
  },
  {
    code: 'folio',
    name: 'Folio',
    description:
      'Gray page with a large INVOICE title, stacked meta rail, and a rounded services card.',
    htmlPath: HTML_PATH,
    theme: { primary: '#2563EB', accent: '#1D4ED8', secondary: '#6B7280' },
    tags: ['Rounded card', 'Meta rail', 'Total due', 'Logo support'],
  },
  {
    code: 'bloom',
    name: 'Bloom',
    description: 'Card stack on gray with To/From panels and a rounded services table.',
    htmlPath: HTML_PATH,
    theme: { primary: '#E11D48', accent: '#BE123C', secondary: '#6B7280' },
    tags: ['Cards', 'To / From', 'Amount due', 'Logo support'],
  },
  {
    code: 'iris',
    name: 'Iris',
    description:
      'Airy white invoice with a three-column issued / billed-to / from grid and a purple amount due.',
    htmlPath: HTML_PATH,
    theme: { primary: '#7C3AED', accent: '#6D28D9', secondary: '#6B7280' },
    tags: ['INVOICE title', 'Three columns', 'Amount due', 'Logo support'],
  },
  {
    code: 'haze',
    name: 'Haze',
    description:
      'Gray sheet with billed-to, invoice date, a lime amount-due chip, and a compact order table.',
    htmlPath: HTML_PATH,
    theme: { primary: '#5B21B6', accent: '#D9F99D', secondary: '#6B7280' },
    tags: ['Amount due chip', 'Order table', 'Billed to', 'Logo support'],
  },
  {
    code: 'ledger',
    name: 'Ledger',
    description:
      'Ruled black-and-white invoice with a large INVOICE title, grid line table, and a right-aligned grand total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#111111', accent: '#111111', secondary: '#6B7280' },
    tags: ['Ruled table', 'Bill To', 'Grand total', 'Logo support'],
  },
  {
    code: 'noir',
    name: 'Noir',
    description:
      'High-contrast invoice with a full-width header bar, Invoice To block, and a right-aligned grand total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#111111', accent: '#111111', secondary: '#6B7280' },
    tags: ['Header bar', 'Invoice To', 'Grand total', 'Logo support'],
  },
  {
    code: 'slate',
    name: 'Slate',
    description:
      'Centered INVOICE header, bordered meta-and-buyer grid, ruled table, and a bold Thank You footer.',
    htmlPath: HTML_PATH,
    theme: { primary: '#111111', accent: '#111111', secondary: '#6B7280' },
    tags: ['Centered title', 'Bill To', 'Grand total', 'Logo support'],
  },
  {
    code: 'charter',
    name: 'Charter',
    description:
      'Navy INVOICE badge, split buyer-and-address column, card-style table, and a centered thank-you footer.',
    htmlPath: HTML_PATH,
    theme: { primary: '#1B2A4E', accent: '#1B2A4E', secondary: '#64748B' },
    tags: ['Navy badge', 'Invoice To', 'Card table', 'Logo support'],
  },
  {
    code: 'matrix',
    name: 'Matrix',
    description:
      'Bordered header grid, light title bar, ruled line table, and column-aligned net total rows.',
    htmlPath: HTML_PATH,
    theme: { primary: '#1E3A5F', accent: '#D6EAF5', secondary: '#64748B' },
    tags: ['Grid header', 'Ruled table', 'Net total', 'Logo support'],
  },
  {
    code: 'ember',
    name: 'Ember',
    description:
      'Orange payment sidebar, From/To header row, gray table header, inline subtotals, and a bold total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#EA580C', secondary: '#6B7280' },
    tags: ['Payment sidebar', 'From / To', 'Orange total', 'Logo support'],
  },
  {
    code: 'summit',
    name: 'Summit',
    description:
      'Dark header band, To block with invoice meta, ruled table, orange payment terms, and a bold total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#111111', secondary: '#6B7280' },
    tags: ['Dark header', 'Orange accent', 'Payment terms', 'Logo support'],
  },
  {
    code: 'flare',
    name: 'Flare',
    description:
      'Orange Invoice badge, centered meta row, qty-and-description table, right-aligned totals, and QR footer.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#EA580C', secondary: '#6B7280' },
    tags: ['Orange badge', 'Unit price line', 'Right totals', 'QR footer'],
  },
  {
    code: 'vault',
    name: 'Vault',
    description:
      'Dark sidebar with invoice meta and buyer, seller brand header, ruled table, and a right-aligned orange total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#111111', secondary: '#6B7280' },
    tags: ['Dark sidebar', 'Orange accent', 'Account name', 'Logo support'],
  },
  {
    code: 'beacon',
    name: 'Beacon',
    description:
      'Bold Invoice title, gray header table with stacked currency, orange grand total, payment/terms panel, and thank-you footer.',
    htmlPath: HTML_PATH,
    theme: { primary: '#F97316', accent: '#EA580C', secondary: '#6B7280' },
    tags: ['Orange total', 'Payment panel', 'Price column', 'Thank you footer'],
  },
  {
    code: 'onyx',
    name: 'Onyx',
    description:
      'High-contrast black header with white meta grid, hairline item table, and a right-aligned invoice total.',
    htmlPath: HTML_PATH,
    theme: { primary: '#111111', accent: '#111111', secondary: '#6B7280' },
    tags: ['Black header', 'Hairline table', 'Amount due', 'TRN block'],
  },
];

const DOCUMENT_TYPE_VARIANTS: DocumentTypeVariant[] = [
  {
    documentType: 'credit_note',
    codePrefix: 'credit-note',
    modernCode: 'credit-note',
    modernName: 'Credit Note',
    modernDescription:
      'Tax credit note for refunds and returns — linked to the original invoice with VAT breakdown.',
    nameSuffix: 'Credit Note',
    descriptionTail: 'tax credit note with VAT breakdown and original invoice reference.',
    extraTags: ['Credit note', 'VAT', 'Original invoice'],
  },
  {
    documentType: 'refund_document',
    codePrefix: 'refund-document',
    modernCode: 'refund-document',
    modernName: 'Refund Document',
    modernDescription:
      'Record of refunded amounts and related order items for customers and accounting purposes.',
    nameSuffix: 'Refund Document',
    descriptionTail: 'refund confirmation for customers and accounting.',
    extraTags: ['Refund document', 'Refund receipt', 'Accounting'],
  },
  {
    documentType: 'packing_slip',
    codePrefix: 'packing-slip',
    modernCode: 'packing-slip',
    modernName: 'Packing Slip',
    modernDescription:
      'Warehouse packing slip with ship-to address, SKUs, and quantities — prices hidden by default.',
    nameSuffix: 'Packing Slip',
    descriptionTail: 'warehouse packing slip with ship-to, SKUs, and quantities (no prices).',
    extraTags: ['Packing slip', 'Ship-to', 'SKU', 'No prices'],
  },
];

function systemCodeFor(variant: DocumentTypeVariant, layoutCode: BaseLayoutCode): string {
  if (layoutCode === 'modern') return variant.modernCode;
  return `${variant.codePrefix}-${layoutCode}`;
}

function systemNameFor(
  seed: LayoutTemplateSeed,
  variant: DocumentTypeVariant,
  layoutCode: BaseLayoutCode
): string {
  if (layoutCode === 'modern') return variant.modernName;
  return `${seed.name} ${variant.nameSuffix}`;
}

function systemDescriptionFor(
  seed: LayoutTemplateSeed,
  variant: DocumentTypeVariant,
  layoutCode: BaseLayoutCode
): string {
  if (layoutCode === 'modern') return variant.modernDescription;
  const base = seed.description.replace(/\s*— ideal for D2C brands\.?$/i, '').replace(/\.$/, '');
  return `${base} — ${variant.descriptionTail}`;
}

function systemTagsFor(seed: LayoutTemplateSeed, variant: DocumentTypeVariant): string[] {
  const merged = [...variant.extraTags];
  for (const tag of seed.tags) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  return merged.slice(0, 6);
}

function buildInvoiceTemplates(): SystemTemplateDefinition[] {
  return INVOICE_LAYOUT_TEMPLATES.map((seed) => ({
    code: seed.code,
    name: seed.name,
    description: seed.description,
    htmlPath: seed.htmlPath,
    baseLayoutCode: seed.code,
    documentType: 'tax_invoice',
    theme: seed.theme,
    tags: seed.tags,
  }));
}

function buildDocumentTypeTemplates(variant: DocumentTypeVariant): SystemTemplateDefinition[] {
  return INVOICE_LAYOUT_TEMPLATES.map((seed) => ({
    code: systemCodeFor(variant, seed.code),
    name: systemNameFor(seed, variant, seed.code),
    description: systemDescriptionFor(seed, variant, seed.code),
    htmlPath: seed.htmlPath,
    baseLayoutCode: seed.code,
    documentType: variant.documentType,
    theme: seed.theme,
    tags: systemTagsFor(seed, variant),
  }));
}

/** Bump when catalog entries change so ensureSystemTemplates re-syncs once per deploy. */
export const SYSTEM_TEMPLATE_CATALOG_VERSION = 1;

export function buildSystemTemplates(): SystemTemplateDefinition[] {
  return [
    ...buildInvoiceTemplates(),
    ...DOCUMENT_TYPE_VARIANTS.flatMap(buildDocumentTypeTemplates),
  ];
}

export const SYSTEM_TEMPLATES = buildSystemTemplates();
