/**
 * Direct refund-document PDF download via /app/credit-notes/:id/refund-document.
 * Filename from server: refund-{creditNoteNumber}.pdf
 */

export type DownloadRefundDocumentPdfOptions = {
  creditNoteId: string;
  creditNoteNumber?: string;
  templateId?: string;
  onError?: (message: string) => void;
};

function filenameFromDisposition(
  disposition: string,
  creditNoteNumber?: string,
): string {
  const match = /filename="([^"]+)"/.exec(disposition);
  if (match?.[1]) {
    const name = match[1];
    return name.endsWith(".pdf") ? name : `${name}.pdf`;
  }
  const fallback = `refund-${creditNoteNumber || "document"}.pdf`.replace(
    /[^\w.\-]+/g,
    "_",
  );
  return fallback.endsWith(".pdf") ? fallback : `${fallback}.pdf`;
}

export async function downloadRefundDocumentPdf(
  options: DownloadRefundDocumentPdfOptions,
): Promise<boolean> {
  const id = String(options.creditNoteId ?? "").trim();
  if (!id) return false;

  try {
    const qs = new URLSearchParams({ mode: "download" });
    if (options.templateId) qs.set("templateId", options.templateId);
    const response = await fetch(
      `/app/credit-notes/${encodeURIComponent(id)}/refund-document?${qs.toString()}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
      },
    );
    if (!response.ok) {
      options.onError?.("Failed to download refund document. Try again.");
      return false;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = filenameFromDisposition(
      disposition,
      options.creditNoteNumber,
    );
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    options.onError?.("Failed to download refund document. Try again.");
    return false;
  }
}

export type DownloadRefundDocumentsBulkPdfOptions = {
  creditNoteIds: string[];
  templateId?: string;
  onError?: (message: string) => void;
};

/** Bulk PDF via /app/refund-documents/bulk?mode=download */
export async function downloadRefundDocumentsBulkPdf(
  options: DownloadRefundDocumentsBulkPdfOptions,
): Promise<boolean> {
  const ids = [
    ...new Set(
      (options.creditNoteIds ?? [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return false;

  try {
    const qs = new URLSearchParams({
      ids: ids.join(","),
      mode: "download",
    });
    if (options.templateId) qs.set("templateId", options.templateId);
    const response = await fetch(
      `/app/refund-documents/bulk?${qs.toString()}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
      },
    );
    if (!response.ok) {
      options.onError?.(
        response.status === 400
          ? "You can download up to 50 refund documents at once."
          : "Failed to download refund documents. Try again.",
      );
      return false;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1]?.endsWith(".pdf")
      ? match[1]
      : `refund-documents-${ids.length}.pdf`;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    options.onError?.("Failed to download refund documents. Try again.");
    return false;
  }
}
