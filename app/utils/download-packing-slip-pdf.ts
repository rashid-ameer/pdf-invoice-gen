/**
 * Direct packing-slip PDF download via /app/invoices/:id/packing-slip (G5/G7).
 * Plain fetch — no React Router navigation, no new tab, no table loading.
 */

export type DownloadPackingSlipPdfOptions = {
  invoiceId: string;
  /** Prefer order number for fallback filename; invoice number if unavailable. */
  orderNumber?: string;
  invoiceNumber?: string;
  onError?: (message: string) => void;
};

function filenameFromDisposition(
  disposition: string,
  fallbackBase?: string,
): string {
  const match = /filename="([^"]+)"/.exec(disposition);
  if (match?.[1]) {
    const name = match[1];
    return name.endsWith(".pdf") ? name : `${name}.pdf`;
  }
  const base = (fallbackBase || "packing-slip").replace(/[^\w.\-]+/g, "_");
  const withPrefix = base.startsWith("packing-slip")
    ? base
    : `packing-slip-${base}`;
  return withPrefix.endsWith(".pdf") ? withPrefix : `${withPrefix}.pdf`;
}

/**
 * Fetch the packing-slip PDF and trigger a same-tab file download.
 */
export async function downloadPackingSlipPdf(
  options: DownloadPackingSlipPdfOptions,
): Promise<boolean> {
  const id = String(options.invoiceId ?? "").trim();
  if (!id) return false;

  try {
    const response = await fetch(
      `/app/invoices/${encodeURIComponent(id)}/packing-slip`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
      },
    );
    if (!response.ok) {
      options.onError?.("Failed to download packing slip. Try again.");
      return false;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const fallback =
      options.orderNumber || options.invoiceNumber || "packing-slip";
    const filename = filenameFromDisposition(disposition, fallback);
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
    options.onError?.("Failed to download packing slip. Try again.");
    return false;
  }
}
