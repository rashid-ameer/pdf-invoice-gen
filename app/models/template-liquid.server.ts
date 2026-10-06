/**
 * Group 14 — Liquid helpers used by template CRUD (Phase A create defaults).
 * Full Liquid validate/render lands in Phase C; renderLiquidTemplate stays stubbed.
 */

import type { DocumentType } from "../types/index";
import { defaultLiquidSource } from "./template-liquid.defaults";

export {
  buildLiquidFromConfig,
  defaultLiquidSource,
  LIQUID_VARIABLE_HELP,
} from "./template-liquid.defaults";

export { renderLiquidTemplate } from "./template-liquid-stub.server";

export function templateSourceKind(template: {
  sourceType?: string | null;
  customHtml?: string | null;
}): "layout" | "imported" | "code" {
  if (template.sourceType === "code") return "code";
  if (template.sourceType === "imported") return "imported";
  if (typeof template.customHtml === "string" && template.customHtml.trim()) {
    return "imported";
  }
  return "layout";
}

/** Old starterLiquidFor — prefers existing HTML, else default starter Liquid. */
export function starterLiquidFor(
  documentType: DocumentType,
  existingHtml?: string | null,
): string {
  const existing = typeof existingHtml === "string" ? existingHtml.trim() : "";
  if (existing) return existing;
  return defaultLiquidSource(documentType);
}
