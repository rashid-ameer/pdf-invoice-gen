/**
 * Client-safe initial-setup helpers (no Prisma / Node APIs).
 */
import type { DocumentType } from "../types/index";
import { templatesChangeHref } from "../utils/template-type-slug";

export const INITIAL_SETUP_REQUIRED_KEY = "initial_setup_required";
export const INITIAL_SETUP_COMPLETED_KEY = "initial_setup_completed";
/** After Finish: Setup stays on Home until the merchant dismisses it. */
export const INITIAL_SETUP_DISMISSED_KEY = "initial_setup_dismissed";

/** Onboarding template selection order (Invoice → Packing slip → Credit note → Refund). */
export const INITIAL_SETUP_TEMPLATE_ORDER: DocumentType[] = [
  "tax_invoice",
  "packing_slip",
  "credit_note",
  "refund_document",
];

export function isInitialSetupPathAllowed(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return true;
  if (path === "/app/settings/company") return true;
  if (path === "/app/settings/templates") return true;
  if (path.startsWith("/app/settings/templates/")) return true;
  return false;
}

/** Href for the next template selection step during onboarding. */
export function initialSetupTemplateHref(documentType: DocumentType): string {
  return `${templatesChangeHref(documentType)}?setup=1`;
}

export function isInitialSetupQuery(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}
