import type { DocumentType } from "../types/index";
import type { TemplateConfig } from "./template-config.types";
import type { TemplateRenderInvoiceData } from "./template-render-engine.server";

/** Pagination metadata for imported templates (Group 14). */
export type PaginationValidation = {
  pageCount?: number;
  warnings?: string[];
  [key: string]: unknown;
};

/** Group 14 will port imported HTML fill. Layout templates never call this. */
export function fillImportedTemplateHtml(
  _html: string,
  _config: TemplateConfig,
  _data: TemplateRenderInvoiceData,
  _documentType: DocumentType,
  _paginationValidation?: PaginationValidation,
): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;padding:48px;color:#6d7175;text-align:center">
        <p>Imported HTML templates are not available yet (Group 14). Use a system layout template.</p></body></html>`;
}
