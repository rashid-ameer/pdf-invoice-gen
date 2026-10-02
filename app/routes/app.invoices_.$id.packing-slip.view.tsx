import type { LoaderFunctionArgs } from "react-router";

import { renderPackingSlipDocument } from "../models/invoice-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
  wrapA4EmbedHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/invoices/:id/packing-slip/view
 * Packing-slip HTML via G5/G7. Does NOT record packing_slip_downloaded.
 * embed=1 → raw A4 HTML for print; else A4 viewer with download link.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId = url.searchParams.get("templateId") ?? undefined;
  const embed = url.searchParams.get("embed") === "1";

  const doc = await renderPackingSlipDocument(
    session.shop,
    invoiceId,
    templateId,
  );
  if (!doc) {
    throw new Response("Packing slip not found", { status: 404 });
  }

  if (embed) {
    return htmlDocumentResponse(wrapA4EmbedHtml(doc.html));
  }

  const laidOut = applyA4DocumentLayout(doc.html);
  const downloadQs = new URLSearchParams({
    templateId: doc.templateId,
  });
  const html = wrapA4DocumentViewerHtml(laidOut, {
    title: `Packing slip ${doc.orderNumber}`,
    subtitle: `Template: ${doc.templateName} · A4`,
    downloadUrl: `/app/invoices/${encodeURIComponent(invoiceId)}/packing-slip?${downloadQs.toString()}`,
  });
  return htmlDocumentResponse(html);
};
