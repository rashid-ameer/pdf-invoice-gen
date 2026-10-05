import type { LoaderFunctionArgs } from "react-router";

import { renderCreditNoteDocument } from "../models/credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
  wrapA4EmbedHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/credit-notes/:id/view
 * Resolves credit_note template at view-time (Group 5) and renders HTML (Group 7).
 * Does NOT record download (old view route).
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

  const doc = await renderCreditNoteDocument(
    session.shop,
    creditNoteId,
    templateId,
  );
  if (!doc) {
    throw new Response("Credit note not found", { status: 404 });
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
    title: `Credit note ${doc.creditNoteNumber}`,
    subtitle: `Template: ${doc.templateName} · A4`,
    downloadUrl: `/app/credit-notes/${encodeURIComponent(creditNoteId)}/download?${downloadQs.toString()}`,
  });
  return htmlDocumentResponse(html);
};
