import type { LoaderFunctionArgs } from "react-router";

import {
  BULK_REFUND_DOCUMENT_LIMIT,
  recordRefundDocumentDownload,
  renderRefundDocumentsBulk,
} from "../models/credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4PreviewHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/refund-documents/bulk?ids=…&templateId=…&mode=print|preview&embed=1
 * Bulk refund_document HTML for browser print only (no bulk PDF download).
 * Cap 50. Records download for every selected id on success.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const creditNoteIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const templateId = url.searchParams.get("templateId") ?? undefined;
  const embed = url.searchParams.get("embed") === "1";
  const modeParam = url.searchParams.get("mode");
  const mode = modeParam ?? (embed ? "print" : "print");

  if (creditNoteIds.length === 0) {
    throw new Response("Select at least one refund", { status: 400 });
  }
  if (creditNoteIds.length > BULK_REFUND_DOCUMENT_LIMIT) {
    throw new Response("You can print up to 50 refund documents at once", {
      status: 400,
    });
  }

  if (mode === "download") {
    throw new Response("Bulk PDF download is not supported for refund documents", {
      status: 400,
    });
  }

  const bulk = await renderRefundDocumentsBulk(
    session.shop,
    creditNoteIds,
    templateId,
  );
  if (!bulk) {
    throw new Response("No refund documents found", { status: 404 });
  }

  await Promise.all(
    creditNoteIds.map((id) =>
      recordRefundDocumentDownload(
        session.shop,
        id,
        bulk.templateId,
        bulk.templateName,
      ),
    ),
  );

  const laidOut = applyA4DocumentLayout(bulk.html);
  if (embed || mode === "print" || mode === "preview") {
    return htmlDocumentResponse(laidOut);
  }
  return htmlDocumentResponse(wrapA4PreviewHtml(laidOut));
};
