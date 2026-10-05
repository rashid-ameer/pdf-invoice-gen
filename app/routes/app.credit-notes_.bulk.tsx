import type { LoaderFunctionArgs } from "react-router";

import {
  BULK_CREDIT_NOTE_LIMIT,
  recordCreditNoteDownload,
  renderCreditNotesBulk,
  renderCreditNotesBulkPdf,
} from "../models/credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4PreviewHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import {
  htmlDocumentResponse,
  pdfDownloadResponse,
} from "../utils/document-response.server";

/**
 * GET /app/credit-notes/bulk?ids=…&templateId=…&mode=download|print|preview&embed=1
 * Bulk credit_note HTML merge or combined PDF. Cap 50 (old app).
 * Old bulk route records download for every selected id on success
 * (both print and download modes).
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
    throw new Response("Select at least one credit note", { status: 400 });
  }
  if (creditNoteIds.length > BULK_CREDIT_NOTE_LIMIT) {
    throw new Response("You can print up to 50 credit notes at once", {
      status: 400,
    });
  }

  if (mode === "download") {
    const result = await renderCreditNotesBulkPdf(
      session.shop,
      creditNoteIds,
      templateId,
    );
    if (!result) {
      throw new Response("No credit notes found", { status: 404 });
    }
    await Promise.all(
      creditNoteIds.map((id) =>
        recordCreditNoteDownload(
          session.shop,
          id,
          result.templateId,
          result.templateName,
        ),
      ),
    );
    return pdfDownloadResponse(result.pdf, `credit-notes-${result.count}`);
  }

  const bulk = await renderCreditNotesBulk(
    session.shop,
    creditNoteIds,
    templateId,
  );
  if (!bulk) {
    throw new Response("No credit notes found", { status: 404 });
  }

  // Old bulk print/preview also records download for each selected id.
  await Promise.all(
    creditNoteIds.map((id) =>
      recordCreditNoteDownload(
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
