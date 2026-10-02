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
 * Open a dedicated tab that contains only the rendered invoice and triggers
 * the native print dialog. Does not alter the Invoices page DOM.
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
  tab.opener = null;
  try {
    tab.focus();
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
 * then print via a dedicated tab. Opens the blank tab synchronously on click
 * to reduce popup-blocker issues; does not mutate the Invoices page or use
 * React Router navigation (no table loading state).
 */
export async function fetchAndPrintInvoiceDocument(
  invoiceId: string,
): Promise<void> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return;

  // Open in the user-gesture turn so the browser allows the print tab.
  const tab = window.open("about:blank", "_blank");
  if (!tab) return;

  try {
    tab.document.open();
    tab.document.write(
      "<!DOCTYPE html><title>Preparing invoice…</title><body></body>",
    );
    tab.document.close();

    const response = await fetch(
      `/app/invoices/${encodeURIComponent(id)}/view?embed=1`,
      {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      },
    );
    if (!response.ok) {
      tab.close();
      return;
    }
    const html = await response.text();
    if (!html.trim() || !/<body[\s>]/i.test(html)) {
      tab.close();
      return;
    }
    printHtmlInDedicatedTab(html, tab);
  } catch {
    try {
      tab.close();
    } catch {
      // ignore
    }
  }
}
