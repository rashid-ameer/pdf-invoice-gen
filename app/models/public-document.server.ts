/**
 * Group 13 Phase B — unauthenticated public HTML/PDF document routes.
 *
 * Port of public handlers in `uae-invoiceing-app/server/routes/app.routes.ts`.
 * Token security lives in Phase A (`public-link.server.ts`).
 * No download/status events. Verification/QR attached via G7 render when enabled (Phase C).
 */

import {
  renderCreditNoteDocument,
  renderRefundDocument,
} from "./credit-note-document.server";
import {
  applyA4DocumentLayout,
  wrapA4DocumentViewerHtml,
} from "./document-preview.server";
import { renderInvoiceDocument } from "./invoice-document.server";
import { cachedHtmlToPdfBuffer, pdfFilename } from "./pdf-cache.server";
import {
  formatPublicLinkExpiry,
  resolveCreditNoteByPublicToken,
  resolveInvoiceByPublicToken,
  type CreditNotePublicDocumentType,
} from "./public-link.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

export const PUBLIC_LINK_INVALID_MESSAGE =
  "Document link is invalid or expired";

function publicLinkNotFound(detail?: string): Response {
  if (detail) {
    console.warn("[public] link rejected:", detail);
  }
  return new Response(PUBLIC_LINK_INVALID_MESSAGE, { status: 404 });
}

function publicPdfDownloadResponse(
  pdf: Buffer,
  filenameBase: string,
): Response {
  const filename = pdfFilename(filenameBase);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}

/** Old public filename base: `{number}-{TemplateNameWithDashes}`. */
export function publicInvoicePdfBasename(
  invoiceNumber: string,
  templateName: string,
): string {
  return `${invoiceNumber}-${templateName.replace(/\s+/g, "-")}`;
}

/** Old public CN/refund filename base (refund uses `Refund-` prefix). */
export function publicCreditNotePdfBasename(
  creditNoteNumber: string,
  templateName: string,
  documentType: CreditNotePublicDocumentType,
): string {
  const label =
    documentType === "refund_document"
      ? `Refund-${creditNoteNumber}`
      : creditNoteNumber;
  return `${label}-${templateName.replace(/\s+/g, "-")}`;
}

export async function handlePublicInvoiceView(token: string): Promise<Response> {
  try {
    const resolved = await resolveInvoiceByPublicToken(token);
    if (!resolved) {
      return publicLinkNotFound("invoice token not resolved");
    }

    const doc = await renderInvoiceDocument(
      resolved.shopDomain,
      resolved.invoice.id,
    );
    if (!doc) {
      console.error("[public] invoice render failed", {
        invoiceId: resolved.invoice.id,
        shop: resolved.shopDomain,
      });
      return new Response(
        "Invoice could not be rendered. Try opening the link again.",
        { status: 500 },
      );
    }

    const laidOut = applyA4DocumentLayout(doc.html);
    return htmlDocumentResponse(
      wrapA4DocumentViewerHtml(laidOut, {
        title: `Invoice ${doc.invoiceNumber}`,
        subtitle: `Secure link · ${formatPublicLinkExpiry(resolved.expiresAt)}`,
        downloadUrl: `/public/invoices/${encodeURIComponent(token)}/download`,
        showPrint: true,
      }),
    );
  } catch (error) {
    console.error("[public] invoice view error:", error);
    return new Response("Failed to load invoice", { status: 500 });
  }
}

export async function handlePublicInvoiceDownload(
  token: string,
): Promise<Response> {
  try {
    const resolved = await resolveInvoiceByPublicToken(token);
    if (!resolved) {
      return publicLinkNotFound("invoice download token not resolved");
    }

    const doc = await renderInvoiceDocument(
      resolved.shopDomain,
      resolved.invoice.id,
    );
    if (!doc) {
      console.error("[public] invoice download render failed", {
        invoiceId: resolved.invoice.id,
        shop: resolved.shopDomain,
      });
      return new Response(
        "Invoice could not be rendered. Try opening the link again.",
        { status: 500 },
      );
    }

    // Public PDF must NOT call recordInvoiceDownload / create status events.
    const laidOut = applyA4DocumentLayout(doc.html);
    const pdf = await cachedHtmlToPdfBuffer(laidOut);
    return publicPdfDownloadResponse(
      pdf,
      publicInvoicePdfBasename(doc.invoiceNumber, doc.templateName),
    );
  } catch (error) {
    console.error("[public] invoice download error:", error);
    return new Response("Failed to download invoice", { status: 500 });
  }
}

export async function handlePublicCreditNoteView(
  token: string,
  documentType: CreditNotePublicDocumentType,
): Promise<Response> {
  try {
    const resolved = await resolveCreditNoteByPublicToken(token, documentType);
    if (!resolved) {
      return publicLinkNotFound(`${documentType} token not resolved`);
    }

    const creditNoteId = resolved.creditNote.id;
    const doc =
      documentType === "refund_document"
        ? await renderRefundDocument(resolved.shopDomain, creditNoteId)
        : await renderCreditNoteDocument(resolved.shopDomain, creditNoteId);
    if (!doc) {
      console.error("[public] credit note render failed", {
        creditNoteId,
        shop: resolved.shopDomain,
        documentType,
      });
      return new Response(
        "Document could not be rendered. Try opening the link again.",
        { status: 500 },
      );
    }

    const publicPath =
      documentType === "refund_document" ? "refund-documents" : "credit-notes";
    const title =
      documentType === "refund_document"
        ? `Refund ${doc.creditNoteNumber}`
        : `Credit note ${doc.creditNoteNumber}`;

    const laidOut = applyA4DocumentLayout(doc.html);
    return htmlDocumentResponse(
      wrapA4DocumentViewerHtml(laidOut, {
        title,
        subtitle: `Secure link · ${formatPublicLinkExpiry(resolved.expiresAt)}`,
        downloadUrl: `/public/${publicPath}/${encodeURIComponent(token)}/download`,
        showPrint: true,
      }),
    );
  } catch (error) {
    console.error(`[public] ${documentType} view error:`, error);
    return new Response(
      documentType === "refund_document"
        ? "Failed to load refund document"
        : "Failed to load credit note",
      { status: 500 },
    );
  }
}

export async function handlePublicCreditNoteDownload(
  token: string,
  documentType: CreditNotePublicDocumentType,
): Promise<Response> {
  try {
    const resolved = await resolveCreditNoteByPublicToken(token, documentType);
    if (!resolved) {
      return publicLinkNotFound(`${documentType} download token not resolved`);
    }

    const creditNoteId = resolved.creditNote.id;
    const doc =
      documentType === "refund_document"
        ? await renderRefundDocument(resolved.shopDomain, creditNoteId)
        : await renderCreditNoteDocument(resolved.shopDomain, creditNoteId);
    if (!doc) {
      console.error("[public] credit note download render failed", {
        creditNoteId,
        shop: resolved.shopDomain,
        documentType,
      });
      return new Response(
        "Document could not be rendered. Try opening the link again.",
        { status: 500 },
      );
    }

    // Public PDF must NOT call recordCreditNoteDownload / recordRefundDocumentDownload.
    const laidOut = applyA4DocumentLayout(doc.html);
    const pdf = await cachedHtmlToPdfBuffer(laidOut);
    return publicPdfDownloadResponse(
      pdf,
      publicCreditNotePdfBasename(
        doc.creditNoteNumber,
        doc.templateName,
        documentType,
      ),
    );
  } catch (error) {
    console.error(`[public] ${documentType} download error:`, error);
    return new Response(
      documentType === "refund_document"
        ? "Failed to download refund document"
        : "Failed to download credit note",
      { status: 500 },
    );
  }
}
