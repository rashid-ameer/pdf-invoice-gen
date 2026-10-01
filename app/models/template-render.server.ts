/**
 * Public facade for the system-layout HTML renderer.
 * Layout implementations live in template-render-engine.server.ts
 * (ported from the old app; internal splits can continue without changing callers).
 */
export {
  renderTemplateFromConfig,
  mergeDocumentHtml,
  type TemplateRenderInvoiceData,
  type TemplateRenderOptions,
} from "./template-render-engine.server";
