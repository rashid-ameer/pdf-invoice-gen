/**
 * Client helpers for native browser print of G5/G7 invoice HTML.
 * Same document source as Invoice Details preview (`wrapA4EmbedHtml` / view?embed=1).
 *
 * Details page: print the existing preview iframe when ready.
 * Invoices table: open a dedicated print tab with only the rendered invoice
 * (Chromium cannot reliably print from a non-visible same-page iframe without
 * either a blank preview or flashing the document into the UI).
 */

export type PrintInvoiceHtmlOptions = {
  /** When set and ready, prefer printing this iframe (Details page). */
  iframe?: HTMLIFrameElement | null;
  iframeReady?: boolean;
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
 * Details: prints the on-page preview iframe when ready.
 * Otherwise: dedicated print tab (reliable; no visible flash on the list page).
 */
export function printInvoiceHtml(
  html: string,
  options: PrintInvoiceHtmlOptions = {},
): void {
  if (!html) return;

  const iframe = options.iframe ?? null;
  const iframeWin = iframe?.contentWindow;
  const iframeDoc = iframe?.contentDocument;

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

  printHtmlInDedicatedTab(html);
}

/**
 * Fetch the same embed HTML used by Invoice Details (G5/G7 via view?embed=1),
 * then print via a dedicated tab.
 */
export async function fetchAndPrintInvoiceDocument(
  invoiceId: string,
): Promise<void> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return;
  await fetchAndPrintInvoiceDocuments([id]);
}

/**
 * Bulk print: reuses GET /app/invoices/bulk?mode=preview&embed=1 → renderInvoicesBulk
 * (G5/G7) + applyA4DocumentLayout with .doc-page breaks (one page per invoice).
 * Dedicated print tab only — never injects invoice HTML into the Invoices page.
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

    const url =
      ids.length === 1
        ? `/app/invoices/${encodeURIComponent(ids[0])}/view?embed=1`
        : `/app/invoices/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=preview&embed=1`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      writeTabMessage(
        tab,
        "Print failed",
        `Could not prepare invoices (HTTP ${response.status}).`,
      );
      return;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      writeTabMessage(
        tab,
        "Print failed",
        "Server returned a non-HTML document. Close this tab and try again.",
      );
      return;
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      writeTabMessage(
        tab,
        "Print failed",
        "Invoice HTML was empty or incomplete.",
      );
      return;
    }

    printHtmlInDedicatedTab(html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare invoices. Check your connection and try again.",
    );
  }
}

/**
 * Fetch packing-slip embed HTML and print via a dedicated tab.
 * Single: view?embed=1. Bulk: /app/packing-slips/bulk?mode=preview&embed=1.
 * Does not record packing_slip_downloaded.
 */
export async function fetchAndPrintPackingSlipDocument(
  invoiceId: string,
): Promise<void> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return;
  await fetchAndPrintPackingSlipDocuments([id]);
}

/**
 * Bulk packing-slip print. Dedicated print tab only — never injects HTML into
 * the Packing Slips page. Always pass mode=preview&embed=1 for HTML.
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

    const url =
      ids.length === 1
        ? `/app/invoices/${encodeURIComponent(ids[0])}/packing-slip/view?embed=1`
        : `/app/packing-slips/bulk?ids=${encodeURIComponent(ids.join(","))}&mode=preview&embed=1`;

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      writeTabMessage(
        tab,
        "Print failed",
        `Could not prepare packing slips (HTTP ${response.status}).`,
      );
      return;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      writeTabMessage(
        tab,
        "Print failed",
        "Server returned a non-HTML document. Close this tab and try again.",
      );
      return;
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      writeTabMessage(
        tab,
        "Print failed",
        "Packing slip HTML was empty or incomplete.",
      );
      return;
    }

    printHtmlInDedicatedTab(html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare packing slips. Check your connection and try again.",
    );
  }
}

/**
 * Fetch credit-note embed HTML and print via a dedicated tab.
 * Single: /view?embed=1&templateId=…. Bulk: /bulk?mode=print&embed=1.
 * Bulk print records download status (old credit-notes bulk route).
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
 * Bulk credit-note print. Dedicated print tab only.
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
      writeTabMessage(
        tab,
        "Print failed",
        response.status === 400
          ? "You can print up to 50 credit notes at once."
          : `Could not prepare credit notes (HTTP ${response.status}).`,
      );
      return;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      writeTabMessage(
        tab,
        "Print failed",
        "Server returned a non-HTML document. Close this tab and try again.",
      );
      return;
    }

    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      writeTabMessage(
        tab,
        "Print failed",
        "Credit note HTML was empty or incomplete.",
      );
      return;
    }

    printHtmlInDedicatedTab(html, tab);
  } catch {
    writeTabMessage(
      tab,
      "Print failed",
      "Could not prepare credit notes. Check your connection and try again.",
    );
  }
}
