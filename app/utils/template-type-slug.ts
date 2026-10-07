import type { DocumentType } from "../types/index";

/** URL slug ↔ DocumentType for Templates overview / change routes (UI only). */
export const TEMPLATE_DOC_TYPES: Array<{
  value: DocumentType;
  slug: string;
  label: string;
  pluralLower: string;
}> = [
  {
    value: "tax_invoice",
    slug: "tax-invoice",
    label: "Tax invoices",
    pluralLower: "tax invoices",
  },
  {
    value: "credit_note",
    slug: "credit-note",
    label: "Credit notes",
    pluralLower: "credit notes",
  },
  {
    value: "refund_document",
    slug: "refund-document",
    label: "Refund documents",
    pluralLower: "refund documents",
  },
  {
    value: "packing_slip",
    slug: "packing-slip",
    label: "Packing slips",
    pluralLower: "packing slips",
  },
];

export function documentTypeToSlug(type: DocumentType): string {
  return (
    TEMPLATE_DOC_TYPES.find((t) => t.value === type)?.slug ?? "tax-invoice"
  );
}

export function documentTypeLabel(type: DocumentType): string {
  return TEMPLATE_DOC_TYPES.find((t) => t.value === type)?.label ?? type;
}

/**
 * Accepts hyphen slugs (`tax-invoice`) and legacy query values (`tax_invoice`).
 */
export function parseTemplateTypeParam(
  value: string | null | undefined,
): DocumentType | null {
  if (!value) return null;
  const raw = value.trim();
  const bySlug = TEMPLATE_DOC_TYPES.find((t) => t.slug === raw);
  if (bySlug) return bySlug.value;
  const underscored = raw.replace(/-/g, "_");
  const byValue = TEMPLATE_DOC_TYPES.find((t) => t.value === underscored);
  if (byValue) return byValue.value;
  return null;
}

export function templatesOverviewHref(type?: DocumentType): string {
  if (!type || type === "tax_invoice") return "/app/templates";
  return `/app/templates?type=${encodeURIComponent(documentTypeToSlug(type))}`;
}

export function templatesChangeHref(type: DocumentType): string {
  return `/app/templates/${encodeURIComponent(documentTypeToSlug(type))}/change`;
}
