import type { LoaderFunctionArgs } from "react-router";

import { renderInvoiceDocument } from "../models/invoice-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
  wrapA4EmbedHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/invoices/:id/view
 * Resolves template at view-time (Group 5) and renders HTML (Group 7). No QR.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId = url.searchParams.get("templateId") ?? undefined;
  const embed = url.searchParams.get("embed") === "1";

  const doc = await renderInvoiceDocument(session.shop, invoiceId, templateId);
  if (!doc) {
    throw new Response("Invoice not found", { status: 404 });
  }

  if (embed) {
    return htmlDocumentResponse(wrapA4EmbedHtml(doc.html));
  }

  const laidOut = applyA4DocumentLayout(doc.html);
  const downloadQs = new URLSearchParams({
    templateId: doc.templateId,
  });
  const html = wrapA4DocumentViewerHtml(laidOut, {
    title: `Invoice ${doc.invoiceNumber}`,
    subtitle: `Template: ${doc.templateName} · A4`,
    downloadUrl: `/app/invoices/${encodeURIComponent(invoiceId)}/download?${downloadQs.toString()}`,
  });
  return htmlDocumentResponse(html);
};
