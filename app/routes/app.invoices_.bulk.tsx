import type { LoaderFunctionArgs } from "react-router";

import {
  recordInvoiceDownload,
  renderInvoicesBulk,
  renderInvoicesBulkPdf,
  BULK_INVOICE_LIMIT,
} from "../models/invoice-document.server";
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
 * GET /app/invoices/bulk?ids=…&templateId=…&mode=download|preview
 * Bulk HTML merge + optional PDF. Cap BULK_INVOICE_LIMIT. No packing slips / ZIP.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const invoiceIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, BULK_INVOICE_LIMIT);
  const templateId = url.searchParams.get("templateId") ?? undefined;
  const embed = url.searchParams.get("embed") === "1";
  // embed=1 / explicit preview|print → HTML for browser print. Default remains PDF download.
  const modeParam = url.searchParams.get("mode");
  const mode =
    modeParam ??
    (embed ? "preview" : "download");

  if (invoiceIds.length === 0) {
    throw new Response("No invoices selected", { status: 400 });
  }

  if (mode === "download") {
    const result = await renderInvoicesBulkPdf(
      session.shop,
      invoiceIds,
      templateId,
    );
    if (!result) {
      throw new Response("No invoices found for the selected orders", {
        status: 404,
      });
    }
    await Promise.all(
      invoiceIds.map((id) =>
        recordInvoiceDownload(
          session.shop,
          id,
          result.templateId,
          result.templateName,
        ),
      ),
    );
    return pdfDownloadResponse(result.pdf, `invoices-${result.count}`);
  }

  const bulk = await renderInvoicesBulk(session.shop, invoiceIds, templateId);
  if (!bulk) {
    throw new Response("No invoices found for the selected orders", {
      status: 404,
    });
  }

  const laidOut = applyA4DocumentLayout(bulk.html);
  if (embed || mode === "print") {
    return htmlDocumentResponse(laidOut);
  }
  return htmlDocumentResponse(wrapA4PreviewHtml(laidOut));
};
