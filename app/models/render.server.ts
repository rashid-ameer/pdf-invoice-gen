import type { DocumentType } from "../types/index";
import type { BaseLayoutCode, TemplateConfig } from "./template-config.types";
import { mergeConfigWithBranding } from "./template-config.defaults";
import {
  SAMPLE_CREDIT_NOTE_DATA,
  SAMPLE_INVOICE_DATA,
  SAMPLE_PACKING_SLIP_DATA,
  SAMPLE_REFUND_DOCUMENT_DATA,
  getDefaultConfigForLayout,
} from "./template-config.defaults";
import { prepareLineItemsForRender } from "./line-item-render.server";
import {
  renderTemplateFromConfig,
  type TemplateRenderInvoiceData,
  type TemplateRenderOptions,
} from "./template-render.server";
import { applyA4DocumentLayout } from "./document-preview.server";
import { cachedHtmlToPdfBuffer } from "./pdf-cache.server";
import type { ResolvedSocialLinks } from "./social-links.server";

export type RenderBrandingInput = {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  footerText?: string;
  socialLinks?: ResolvedSocialLinks;
} | null;

export type RenderDocumentInput = {
  baseLayoutCode: BaseLayoutCode;
  documentType?: DocumentType;
  config?: TemplateConfig;
  data: TemplateRenderInvoiceData;
  branding?: RenderBrandingInput;
  customHtml?: string | null;
  sourceType?: string | null;
  customCss?: string | null;
  renderOptions?: TemplateRenderOptions;
  /** When true, skip image/barcode async prep (unit tests). */
  skipLinePrep?: boolean;
};

export function sampleRenderDataForDocumentType(
  documentType: DocumentType = "tax_invoice",
): TemplateRenderInvoiceData {
  if (documentType === "packing_slip") {
    return { ...SAMPLE_PACKING_SLIP_DATA } as TemplateRenderInvoiceData;
  }
  if (documentType === "credit_note") {
    return { ...SAMPLE_CREDIT_NOTE_DATA } as TemplateRenderInvoiceData;
  }
  if (documentType === "refund_document") {
    return { ...SAMPLE_REFUND_DOCUMENT_DATA } as TemplateRenderInvoiceData;
  }
  return { ...SAMPLE_INVOICE_DATA } as TemplateRenderInvoiceData;
}

/**
 * Render system-layout document HTML (no QR generation, no Liquid).
 * Consumes already-prepared line fields; optionally inlines images/barcodes.
 */
export async function renderDocumentHtml(
  input: RenderDocumentInput,
): Promise<string> {
  const documentType = input.documentType ?? "tax_invoice";
  const baseConfig =
    input.config ??
    getDefaultConfigForLayout(input.baseLayoutCode, documentType);
  const config = mergeConfigWithBranding(
    baseConfig,
    input.branding ?? null,
    documentType,
  );

  const data: TemplateRenderInvoiceData = {
    ...input.data,
    lineItems: input.skipLinePrep
      ? input.data.lineItems
      : await prepareLineItemsForRender(input.data.lineItems, config),
  };

  return renderTemplateFromConfig(
    input.baseLayoutCode,
    config,
    data,
    documentType,
    input.customHtml,
    undefined,
    input.sourceType ?? "layout",
    input.customCss,
    input.renderOptions,
  );
}

/** HTML with A4 print CSS applied (same as old download/print path). */
export async function renderDocumentHtmlA4(
  input: RenderDocumentInput,
): Promise<string> {
  const html = await renderDocumentHtml(input);
  return applyA4DocumentLayout(html);
}

/** PDF buffer from rendered A4 HTML, via memory cache. */
export async function renderDocumentPdf(
  input: RenderDocumentInput,
): Promise<Buffer> {
  const html = await renderDocumentHtmlA4(input);
  return cachedHtmlToPdfBuffer(html);
}
