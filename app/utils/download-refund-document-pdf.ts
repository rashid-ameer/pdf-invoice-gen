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
