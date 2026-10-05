import type { LoaderFunctionArgs } from "react-router";

import {
  recordRefundDocumentDownload,
  refundDocumentPdfBasename,
  renderRefundDocument,
  renderRefundDocumentPdf,
} from "../models/credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import {
  htmlDocumentResponse,
  pdfDownloadResponse,
} from "../utils/document-response.server";

/**
 * GET /app/credit-notes/:id/refund-document
 * PDF via Group 7. mode=view|print returns HTML viewer.
 * Always records download (old refund-document route), including print/view modes.
 * Filename: refund-{creditNoteNumber}.pdf
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const creditNoteId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId =
    url.searchParams.get("templateId") ??
    url.searchParams.get("template") ??
    undefined;
  const mode = url.searchParams.get("mode") ?? "download";

  if (mode === "print" || mode === "view") {
    const doc = await renderRefundDocument(
      session.shop,
      creditNoteId,
      templateId,
    );
    if (!doc) {
      throw new Response("Refund document not found", { status: 404 });
    }
    await recordRefundDocumentDownload(
      session.shop,
      creditNoteId,
      doc.templateId,
      doc.templateName,
    );
    const laidOut = applyA4DocumentLayout(doc.html);
    const downloadQs = new URLSearchParams({
      mode: "download",
      templateId: doc.templateId,
    });
    return htmlDocumentResponse(
      wrapA4DocumentViewerHtml(laidOut, {
        title: `Refund document ${doc.creditNoteNumber}`,
        subtitle: `Template: ${doc.templateName} · A4`,
        downloadUrl: `/app/credit-notes/${encodeURIComponent(creditNoteId)}/refund-document?${downloadQs.toString()}`,
      }),
    );
  }

  const result = await renderRefundDocumentPdf(
    session.shop,
    creditNoteId,
    templateId,
  );
  if (!result) {
    throw new Response("Refund document not found", { status: 404 });
  }

  await recordRefundDocumentDownload(
    session.shop,
    creditNoteId,
    result.doc.templateId,
    result.doc.templateName,
  );

  return pdfDownloadResponse(
    result.pdf,
    refundDocumentPdfBasename(result.doc.creditNoteNumber),
  );
};
