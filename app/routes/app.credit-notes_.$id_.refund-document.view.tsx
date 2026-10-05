import type { LoaderFunctionArgs } from "react-router";

import { renderRefundDocument } from "../models/credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
  wrapA4EmbedHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/credit-notes/:id/refund-document/view
 * Resolves refund_document template at view-time. Does NOT record download.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const creditNoteId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId =
    url.searchParams.get("templateId") ??
    url.searchParams.get("template") ??
    undefined;
  const embed = url.searchParams.get("embed") === "1";

  const doc = await renderRefundDocument(
    session.shop,
    creditNoteId,
    templateId,
  );
  if (!doc) {
    throw new Response("Refund document not found", { status: 404 });
  }

  if (embed) {
    return htmlDocumentResponse(wrapA4EmbedHtml(doc.html));
  }

  const laidOut = applyA4DocumentLayout(doc.html);
  const downloadQs = new URLSearchParams({
    mode: "download",
    templateId: doc.templateId,
  });
  const html = wrapA4DocumentViewerHtml(laidOut, {
    title: `Refund document ${doc.creditNoteNumber}`,
    subtitle: `Template: ${doc.templateName} · A4`,
    downloadUrl: `/app/credit-notes/${encodeURIComponent(creditNoteId)}/refund-document?${downloadQs.toString()}`,
  });
  return htmlDocumentResponse(html);
};
