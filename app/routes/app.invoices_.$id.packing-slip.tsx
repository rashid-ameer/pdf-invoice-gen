import type { LoaderFunctionArgs } from "react-router";

import {
  recordPackingSlipDownload,
  renderPackingSlipDocumentPdf,
} from "../models/invoice-document.server";
import { authenticate } from "../shopify.server";
import { pdfDownloadResponse } from "../utils/document-response.server";

/**
 * GET /app/invoices/:id/packing-slip
 * Packing-slip PDF via Group 7. Records packing_slip_downloaded (does not flip invoice.status).
 * Filename: packing-slip-{orderNumber}.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId =
    url.searchParams.get("templateId") ??
    url.searchParams.get("template") ??
    undefined;

  const result = await renderPackingSlipDocumentPdf(
    session.shop,
    invoiceId,
    templateId,
  );
  if (!result) {
    throw new Response("Packing slip not found", { status: 404 });
  }

  await recordPackingSlipDownload(
    session.shop,
    invoiceId,
    result.doc.templateId,
    result.doc.templateName,
  );

  const filename = `packing-slip-${result.doc.orderNumber}`;
  return pdfDownloadResponse(result.pdf, filename);
};
