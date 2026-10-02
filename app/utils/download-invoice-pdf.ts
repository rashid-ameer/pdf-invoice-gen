/**
 * Direct browser PDF download via existing /app/invoices/:id/download (G5/G7).
 * Uses plain fetch so React Router does not navigate or show page loading.
 */

export type DownloadInvoicePdfOptions = {
  invoiceId: string;
  invoiceNumber?: string;
  onError?: (message: string) => void;
};

function filenameFromDisposition(
  disposition: string,
  invoiceNumber?: string,
): string {
  const match = /filename="([^"]+)"/.exec(disposition);
  if (match?.[1]) {
    const name = match[1];
    return name.endsWith(".pdf") ? name : `${name}.pdf`;
  }
  const fallback = `${invoiceNumber || "invoice"}.pdf`.replace(
    /[^\w.\-]+/g,
    "_",
  );
  return fallback.endsWith(".pdf") ? fallback : `${fallback}.pdf`;
}

/**
 * Fetch the PDF and trigger a same-tab file download (no new tab / navigation).
 */
export async function downloadInvoicePdf(
  options: DownloadInvoicePdfOptions,
): Promise<boolean> {
  const id = String(options.invoiceId ?? "").trim();
  if (!id) return false;

  try {
    const response = await fetch(
      `/app/invoices/${encodeURIComponent(id)}/download`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
      },
    );
    if (!response.ok) {
      options.onError?.("Failed to download invoice. Try again.");
      return false;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = filenameFromDisposition(
      disposition,
      options.invoiceNumber,
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
    options.onError?.("Failed to download invoice. Try again.");
    return false;
  }
}
