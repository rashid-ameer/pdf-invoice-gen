import type { LoaderFunctionArgs } from "react-router";

import {
  recordInvoiceDownload,
  renderInvoiceDocument,
  renderInvoiceDocumentPdf,
} from "../models/invoice-document.server";
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
 * GET /app/invoices/:id/download
 * PDF via Group 7 cache. mode=view|print returns HTML viewer instead.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "");
  const url = new URL(request.url);
  const templateId =
    url.searchParams.get("templateId") ??
    url.searchParams.get("template") ??
    undefined;
  const mode = url.searchParams.get("mode") ?? "download";

  if (mode === "print" || mode === "view") {
    const doc = await renderInvoiceDocument(session.shop, invoiceId, templateId);
    if (!doc) {
      throw new Response("Invoice not found", { status: 404 });
    }
    await recordInvoiceDownload(
      session.shop,
      invoiceId,
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
        title: `Invoice ${doc.invoiceNumber}`,
        subtitle: `Template: ${doc.templateName} · A4`,
        downloadUrl: `/app/invoices/${encodeURIComponent(invoiceId)}/download?${downloadQs.toString()}`,
      }),
    );
  }

  const result = await renderInvoiceDocumentPdf(
    session.shop,
    invoiceId,
    templateId,
  );
  if (!result) {
    throw new Response("Invoice not found", { status: 404 });
  }

  await recordInvoiceDownload(
    session.shop,
    invoiceId,
    result.doc.templateId,
    result.doc.templateName,
  );

  const filename = `${result.doc.invoiceNumber}-${result.doc.templateName.replace(/\s+/g, "-")}`;
  return pdfDownloadResponse(result.pdf, filename);
};
