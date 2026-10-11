/**
 * Client helpers for native browser print of G5/G7 invoice HTML.
 * Same document source as Invoice Details preview (`wrapA4EmbedHtml` / view?embed=1).
 *
 * Details page: print the existing preview iframe when ready.
 * List pages (invoices, packing slips, credit notes, refunds): load HTML into
 * a preview modal iframe, then print from that iframe (same-page; no dedicated
 * tab). Dedicated-tab helpers remain as legacy fallbacks.
 */

export type PrintInvoiceHtmlOptions = {
  /** When set and ready, prefer printing this iframe (Details / list modal). */
  iframe?: HTMLIFrameElement | null;
  iframeReady?: boolean;
  /**
   * When false, do not fall back to a dedicated print tab if iframe print is
   * unavailable. Used by the invoices list preview modal.
   */
  allowDedicatedTab?: boolean;
};

const PRINT_BOOTSTRAP = `
<style>
@media print {
  html, body {
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
<script>
(function () {
  function runPrint() {
    try {
      window.focus();
      window.print();
    } catch (e) {}
  }
  function whenReady() {
    var imgs = Array.prototype.slice.call(document.images || []);
    if (!imgs.length) {
      setTimeout(runPrint, 100);
      return;
    }
    var left = imgs.length;
    function done() {
      left -= 1;
      if (left <= 0) setTimeout(runPrint, 100);
    }
    imgs.forEach(function (img) {
      if (img.complete) done();
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      }
    });
  }
  if (document.readyState === "complete") whenReady();
  else window.addEventListener("load", whenReady);
})();
</script>
`;

function preparePrintableHtml(html: string): string {
  if (html.includes("</body>")) {
    return html.replace("</body>", `${PRINT_BOOTSTRAP}</body>`);
  }
  return `${html}${PRINT_BOOTSTRAP}`;
}

/**
 * Open a dedicated tab that contains only the rendered invoice(s) and triggers
 * the native print dialog. Does not alter the Invoices page DOM.
 * Keeps the tab open so the browser print dialog can complete.
 */
function printHtmlInDedicatedTab(html: string, existingTab?: Window | null): void {
  const printable = preparePrintableHtml(html);
  const tab =
    existingTab && !existingTab.closed
      ? existingTab
      : window.open("about:blank", "_blank");
  if (!tab) return;

  tab.document.open();
  tab.document.write(printable);
  tab.document.close();
  // Do not set opener=null before print — some browsers treat that as
  // permission to auto-discard the tab. Leave the tab open for the print UI.
  try {
    tab.focus();
  } catch {
    // ignore
  }
}

function writeTabMessage(tab: Window, title: string, message: string): void {
  try {
    tab.document.open();
    tab.document.write(
      `<!DOCTYPE html><html><head><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;"><p>${message}</p><p>You can close this tab and try again.</p></body></html>`,
    );
    tab.document.close();
  } catch {
    // ignore
  }
}

/**
 * Open the browser print dialog for already-rendered invoice HTML.
 * Prefer a ready preview iframe; otherwise open a dedicated print tab
 * (unless `allowDedicatedTab` is false).
 */
export function printInvoiceHtml(
  html: string,
  options: PrintInvoiceHtmlOptions = {},
): void {
  if (!html) return;

  const iframe = options.iframe ?? null;
  const iframeWin = iframe?.contentWindow;
  const iframeDoc = iframe?.contentDocument;
  const allowDedicatedTab = options.allowDedicatedTab !== false;

  if (options.iframeReady && iframeWin && iframeDoc?.body) {
    const previousTransform = iframeDoc.body.style.transform;
    iframeDoc.body.style.transform = "";
    const restore = () => {
      iframeDoc.body.style.transform = previousTransform;
      iframeWin.removeEventListener("afterprint", restore);
    };
    iframeWin.addEventListener("afterprint", restore);
    try {
      iframeWin.focus();
      iframeWin.print();
      return;
    } catch {
      restore();
    }
  }

  if (allowDedicatedTab) {
    printHtmlInDedicatedTab(html);
  }
}

export type FetchInvoiceHtmlResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/**
 * Fetch invoice embed HTML for the list print-preview modal.
 * Single: view?embed=1. Bulk: /app/invoices/bulk?mode=preview&embed=1.
 * Does not open a tab or trigger print.
 */
export async function fetchInvoiceDocumentsHtml(
  invoiceIds: string[],
): Promise<FetchInvoiceHtmlResult> {
  const ids = [
    ...new Set(invoiceIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "No invoices selected." };
  }

  try {
    const url =
      ids.length === 1
        ? `/app/invoices/${encodeURIComponent(ids[0])}/view?embed=1`
        : `/app/invoices/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=preview&embed=1`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 400
            ? "You can print up to 50 invoices at once."
            : `Could not prepare invoices (HTTP ${response.status}).`,
      };
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      return {
        ok: false,
        error: "Server returned a non-HTML document. Try again.",
      };
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      return {
        ok: false,
        error: "Invoice HTML was empty or incomplete.",
      };
    }

    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error: "Could not prepare invoices. Check your connection and try again.",
    };
  }
}

/**
 * Fetch the same embed HTML used by Invoice Details (G5/G7 via view?embed=1),
 * then print via a dedicated tab.
 * Prefer the list preview modal (`fetchInvoiceDocumentsHtml`) for invoices UI.
 */
export async function fetchAndPrintInvoiceDocument(
  invoiceId: string,
): Promise<void> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return;
  await fetchAndPrintInvoiceDocuments([id]);
}

/**
 * Bulk print via dedicated tab (legacy path).
 * Invoices list UI uses the preview modal instead.
 *
 * Important: bulk defaults to PDF download when mode is omitted. Always pass
 * mode=preview (or rely on embed=1 server default) so the response is HTML.
 */
export async function fetchAndPrintInvoiceDocuments(
  invoiceIds: string[],
): Promise<void> {
  const ids = [
    ...new Set(invoiceIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return;

  // Open in the user-gesture turn so the browser allows the print tab.
  const tab = window.open("about:blank", "_blank");
  if (!tab) return;

  try {
    writeTabMessage(tab, "Preparing invoices…", "Preparing invoices for print…");

    const result = await fetchInvoiceDocumentsHtml(ids);
    if (!result.ok) {
      writeTabMessage(tab, "Print failed", result.error);
      return;
    }

    printHtmlInDedicatedTab(result.html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare invoices. Check your connection and try again.",
    );
  }
}

export type FetchDocumentHtmlResult = FetchInvoiceHtmlResult;

/**
 * Fetch packing-slip embed HTML for the list print-preview modal.
 * Single: view?embed=1. Bulk: /app/packing-slips/bulk?mode=preview&embed=1.
 * Does not record packing_slip_downloaded. Does not open a tab or print.
 */
export async function fetchPackingSlipDocumentsHtml(
  invoiceIds: string[],
): Promise<FetchDocumentHtmlResult> {
  const ids = [
    ...new Set(invoiceIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "No packing slips selected." };
  }

  try {
    const url =
      ids.length === 1
        ? `/app/invoices/${encodeURIComponent(ids[0])}/packing-slip/view?embed=1`
        : `/app/packing-slips/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=preview&embed=1`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 400
            ? "You can print up to 50 packing slips at once."
            : `Could not prepare packing slips (HTTP ${response.status}).`,
      };
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      return {
        ok: false,
        error: "Server returned a non-HTML document. Try again.",
      };
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      return {
        ok: false,
        error: "Packing slip HTML was empty or incomplete.",
      };
    }

    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error:
        "Could not prepare packing slips. Check your connection and try again.",
    };
  }
}

/**
 * Fetch packing-slip embed HTML and print via a dedicated tab (legacy path).
 * Prefer the list preview modal (`fetchPackingSlipDocumentsHtml`).
 */
export async function fetchAndPrintPackingSlipDocument(
  invoiceId: string,
): Promise<void> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return;
  await fetchAndPrintPackingSlipDocuments([id]);
}

/**
 * Bulk packing-slip print via dedicated tab (legacy path).
 * Always pass mode=preview&embed=1 for HTML.
 */
export async function fetchAndPrintPackingSlipDocuments(
  invoiceIds: string[],
): Promise<void> {
  const ids = [
    ...new Set(invoiceIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return;

  const tab = window.open("about:blank", "_blank");
  if (!tab) return;

  try {
    writeTabMessage(
      tab,
      "Preparing packing slips…",
      "Preparing packing slips for print…",
    );

    const result = await fetchPackingSlipDocumentsHtml(ids);
    if (!result.ok) {
      writeTabMessage(tab, "Print failed", result.error);
      return;
    }

    printHtmlInDedicatedTab(result.html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare packing slips. Check your connection and try again.",
    );
  }
}

/**
 * Fetch credit-note embed HTML for the list print-preview modal.
 * Single: /view?embed=1&templateId=…. Bulk: /bulk?mode=print&embed=1.
 * Bulk print records download status (old credit-notes bulk route).
 */
export async function fetchCreditNoteDocumentsHtml(
  creditNoteIds: string[],
  templateId?: string,
): Promise<FetchDocumentHtmlResult> {
  const ids = [
    ...new Set(
      creditNoteIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "No credit notes selected." };
  }

  try {
    const templateQs = templateId
      ? `&templateId=${encodeURIComponent(templateId)}`
      : "";
    const url =
      ids.length === 1
        ? `/app/credit-notes/${encodeURIComponent(ids[0])}/view?embed=1${templateQs}`
        : `/app/credit-notes/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=print&embed=1${templateQs}`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 400
            ? "You can print up to 50 credit notes at once."
            : `Could not prepare credit notes (HTTP ${response.status}).`,
      };
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      return {
        ok: false,
        error: "Server returned a non-HTML document. Try again.",
      };
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      return {
        ok: false,
        error: "Credit note HTML was empty or incomplete.",
      };
    }

    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error:
        "Could not prepare credit notes. Check your connection and try again.",
    };
  }
}

/**
 * Fetch credit-note embed HTML and print via a dedicated tab (legacy path).
 * Prefer the list preview modal (`fetchCreditNoteDocumentsHtml`).
 */
export async function fetchAndPrintCreditNoteDocument(
  creditNoteId: string,
  templateId?: string,
): Promise<void> {
  const id = String(creditNoteId ?? "").trim();
  if (!id) return;
  await fetchAndPrintCreditNoteDocuments([id], templateId);
}

/**
 * Bulk credit-note print via dedicated tab (legacy path).
 * Always pass mode=print&embed=1 for HTML (bulk default is print, not PDF).
 */
export async function fetchAndPrintCreditNoteDocuments(
  creditNoteIds: string[],
  templateId?: string,
): Promise<void> {
  const ids = [
    ...new Set(
      creditNoteIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) return;

  const tab = window.open("about:blank", "_blank");
  if (!tab) return;

  try {
    writeTabMessage(
      tab,
      "Preparing credit notes…",
      "Preparing credit notes for print…",
    );

    const result = await fetchCreditNoteDocumentsHtml(ids, templateId);
    if (!result.ok) {
      writeTabMessage(tab, "Print failed", result.error);
      return;
    }

    printHtmlInDedicatedTab(result.html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare credit notes. Check your connection and try again.",
    );
  }
}

/**
 * Fetch refund-document embed HTML for the list print-preview modal.
 * Single: /refund-document/view?embed=1 (does not record).
 * Bulk: /refund-documents/bulk?mode=print&embed=1 (records download — old route).
 */
export async function fetchRefundDocumentsHtml(
  creditNoteIds: string[],
  templateId?: string,
): Promise<FetchDocumentHtmlResult> {
  const ids = [
    ...new Set(
      creditNoteIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return { ok: false, error: "No refund documents selected." };
  }

  try {
    const templateQs = templateId
      ? `&templateId=${encodeURIComponent(templateId)}`
      : "";
    const url =
      ids.length === 1
        ? `/app/credit-notes/${encodeURIComponent(ids[0])}/refund-document/view?embed=1${templateQs}`
        : `/app/refund-documents/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=print&embed=1${templateQs}`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 400
            ? "You can print up to 50 refund documents at once."
            : `Could not prepare refund documents (HTTP ${response.status}).`,
      };
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      return {
        ok: false,
        error: "Server returned a non-HTML document. Try again.",
      };
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      return {
        ok: false,
        error: "Refund document HTML was empty or incomplete.",
      };
    }

    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error:
        "Could not prepare refund documents. Check your connection and try again.",
    };
  }
}

/**
 * Fetch refund-document embed HTML and print via a dedicated tab (legacy path).
 * Prefer the list preview modal (`fetchRefundDocumentsHtml`).
 */
export async function fetchAndPrintRefundDocument(
  creditNoteId: string,
  templateId?: string,
): Promise<void> {
  const id = String(creditNoteId ?? "").trim();
  if (!id) return;
  await fetchAndPrintRefundDocuments([id], templateId);
}

export async function fetchAndPrintRefundDocuments(
  creditNoteIds: string[],
  templateId?: string,
): Promise<void> {
  const ids = [
    ...new Set(
      creditNoteIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) return;

  const tab = window.open("about:blank", "_blank");
  if (!tab) return;

  try {
    writeTabMessage(
      tab,
      "Preparing refund documents…",
      "Preparing refund documents for print…",
    );

    const result = await fetchRefundDocumentsHtml(ids, templateId);
    if (!result.ok) {
      writeTabMessage(tab, "Print failed", result.error);
      return;
    }

    printHtmlInDedicatedTab(result.html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare refund documents. Check your connection and try again.",
    );
  }
}
