/**
 * Direct credit-note PDF download via /app/credit-notes/:id/download (G5/G7).
 * Plain fetch — no React Router navigation, no new tab, no table loading.
 */

export type DownloadCreditNotePdfOptions = {
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
  const fallback = `${creditNoteNumber || "credit-note"}.pdf`.replace(
    /[^\w.\-]+/g,
    "_",
  );
  return fallback.endsWith(".pdf") ? fallback : `${fallback}.pdf`;
}

/**
 * Fetch the credit-note PDF and trigger a same-tab file download.
 */
export async function downloadCreditNotePdf(
  options: DownloadCreditNotePdfOptions,
): Promise<boolean> {
  const id = String(options.creditNoteId ?? "").trim();
  if (!id) return false;

  try {
    const qs = new URLSearchParams({ mode: "download" });
    if (options.templateId) qs.set("templateId", options.templateId);
    const response = await fetch(
      `/app/credit-notes/${encodeURIComponent(id)}/download?${qs.toString()}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
      },
    );
    if (!response.ok) {
      options.onError?.("Failed to download credit note. Try again.");
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
    options.onError?.("Failed to download credit note. Try again.");
    return false;
  }
}

export type DownloadCreditNotesBulkPdfOptions = {
  creditNoteIds: string[];
  templateId?: string;
  onError?: (message: string) => void;
};

/**
 * Bulk PDF download via /app/credit-notes/bulk?mode=download (combined PDF).
 */
export async function downloadCreditNotesBulkPdf(
  options: DownloadCreditNotesBulkPdfOptions,
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
    const response = await fetch(`/app/credit-notes/bulk?${qs.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/pdf" },
    });
    if (!response.ok) {
      options.onError?.(
        response.status === 400
          ? "You can download up to 50 credit notes at once."
          : "Failed to download credit notes. Try again.",
      );
      return false;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1]?.endsWith(".pdf")
      ? match[1]
      : `credit-notes-${ids.length}.pdf`;
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
    options.onError?.("Failed to download credit notes. Try again.");
    return false;
  }
}
