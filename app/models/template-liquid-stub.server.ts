import type { DocumentType } from "../types/index";
import type { TemplateConfig } from "./template-config.types";
import type { TemplateRenderInvoiceData } from "./template-render-engine.server";

/** Group 14 will port Liquid rendering. Layout templates never call this. */
export function renderLiquidTemplate(
  _html: string,
  _data: TemplateRenderInvoiceData,
  _config: TemplateConfig,
  _documentType: DocumentType,
  _customCss: string,
): string {
  throw new Error(
    "Liquid templates are not available yet (Group 14). Use a system layout template.",
  );
}
