const A4_DOCUMENT_STYLES = `
  @page {
    size: A4;
    margin: 10mm;
  }

  html {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    box-sizing: border-box;
    /* overflow:hidden breaks Chromium page-break / multi-doc PDFs */
    overflow: visible;
  }

  /* Each selected document starts on its own printed page */
  .doc-page {
    display: block;
    box-sizing: border-box;
    break-after: page;
    page-break-after: always;
  }

  .doc-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  @media print {
    html, body {
      width: auto;
      min-height: auto;
      overflow: visible !important;
    }
  }
`;

const A4_PREVIEW_STYLES = `
  html {
    background: #525659;
    min-height: 100%;
  }

  body {
    margin: 72px auto 32px;
    background: #fff;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.2),
      0 8px 24px rgba(0, 0, 0, 0.18);
  }

  @media print {
    html {
      background: #fff;
    }

    body {
      width: auto;
      min-height: auto;
      margin: 0;
      box-shadow: none;
    }

    .a4-preview-toolbar {
      display: none !important;
    }
  }

  @media screen and (max-width: 900px) {
    html {
      padding: 0 12px 32px;
    }

    body {
      width: 100%;
      max-width: 210mm;
      min-height: calc((100vw - 24px) * 297 / 210);
      margin-top: 64px;
    }
  }
`;

const PREVIEW_TOOLBAR_STYLES = `
  .a4-preview-toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #202223;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .a4-preview-label {
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .a4-preview-size {
    color: #b5b5b5;
    font-size: 12px;
  }

  .a4-preview-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .a4-preview-print,
  .a4-preview-download {
    padding: 6px 14px;
    border: 1px solid #555;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    color: #fff;
    display: inline-flex;
    align-items: center;
  }

  .a4-preview-print {
    background: #008060;
    border-color: #008060;
  }

  .a4-preview-print:hover {
    background: #006e52;
  }

  .a4-preview-download {
    background: #303030;
  }

  .a4-preview-download:hover {
    background: #404040;
  }

  @media screen and (max-width: 720px) {
    .a4-preview-toolbar {
      flex-wrap: wrap;
      gap: 8px 12px;
      padding: 10px 12px;
    }

    .a4-preview-size {
      order: 3;
      flex: 1 1 100%;
      font-size: 11px;
      line-height: 1.35;
    }

    .a4-preview-actions {
      margin-left: auto;
    }
  }
`;

const A4_PRINT_SCRIPT = `
  function a4PreviewPrint() {
    try {
      var html = '<!DOCTYPE html>' + document.documentElement.outerHTML;
      if (window.top !== window.self) {
        var tab = window.open('about:blank', '_blank');
        if (!tab) {
          alert('Please allow pop-ups to print.');
          return;
        }
        tab.document.open();
        tab.document.write(html);
        tab.document.close();
        tab.opener = null;
        tab.focus();
        setTimeout(function () {
          try {
            tab.focus();
            tab.print();
          } catch (e) {
            alert('Could not print. Please try again.');
          }
        }, 350);
        return;
      }
      window.focus();
      window.print();
    } catch (e) {
      alert('Could not print. Please try again.');
    }
  }
`;

function injectBeforeBodyClose(html: string, snippet: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}</body>`);
  }
  return `${html}${snippet}`;
}

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface A4ViewerOptions {
  /** Short label shown in the toolbar, e.g. "Invoice INV-00001" */
  title?: string;
  /** Secondary text, e.g. template name or link expiry */
  subtitle?: string;
  /** Absolute or relative URL that returns the file as an attachment */
  downloadUrl?: string;
  /** Show Print button (default true) */
  showPrint?: boolean;
}

function buildToolbarHtml(options: A4ViewerOptions = {}): string {
  const title = options.title?.trim() || 'A4 preview';
  const subtitle =
    options.subtitle?.trim() || '210 × 297 mm · same layout as PDF download';
  const showPrint = options.showPrint !== false;
  const printBtn = showPrint
    ? `<button type="button" class="a4-preview-print" onclick="a4PreviewPrint()">Print</button>`
    : '';
  const downloadBtn = options.downloadUrl
    ? `<a class="a4-preview-download" href="${escAttr(options.downloadUrl)}" download>Download</a>`
    : '';

  return `
  <div class="a4-preview-toolbar">
    <span class="a4-preview-label">${escText(title)}</span>
    <span class="a4-preview-size">${escText(subtitle)}</span>
    <div class="a4-preview-actions">
      ${printBtn}
      ${downloadBtn}
    </div>
  </div>`;
}

function injectStyles(html: string, css: string): string {
  const block = `<style>${css}</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${block}</head>`);
  }
  return `${block}${html}`;
}

function injectAfterBodyOpen(html: string, snippet: string): string {
  return html.replace(/<body([^>]*)>/i, `<body$1>${snippet}`);
}

function ensureViewport(html: string): string {
  if (/name=["']viewport["']/i.test(html)) return html;
  if (html.includes('</head>')) {
    return html.replace(
      '</head>',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>'
    );
  }
  return html;
}

export function applyA4DocumentLayout(html: string): string {
  return injectStyles(ensureViewport(html), A4_DOCUMENT_STYLES);
}

/** Gray chrome around the A4 page — matches in-app preview (without toolbar). */
export function wrapA4ThumbnailHtml(html: string): string {
  let output = applyA4DocumentLayout(html);
  output = injectStyles(output, A4_PREVIEW_STYLES);
  return output;
}

/**
 * Invoice details embed: same A4 document + preview chrome as the viewer,
 * fitted to a narrow Polaris column (no toolbar — page actions own Print/Download).
 */
export function wrapA4EmbedHtml(html: string): string {
  let output = wrapA4ThumbnailHtml(html);
  output = injectStyles(
    output,
    `
  html {
    background: #f1f2f3;
    overflow-x: auto;
  }

  body {
    margin: 16px auto !important;
  }
`,
  );
  return output;
}

/** Legacy preview wrapper (print-only toolbar). */
export function wrapA4PreviewHtml(html: string): string {
  return wrapA4DocumentViewerHtml(html, {
    title: 'A4 preview',
    subtitle: '210 × 297 mm · same layout as PDF download',
  });
}

/** A4 document viewer with Print + optional Download. */
export function wrapA4DocumentViewerHtml(html: string, options: A4ViewerOptions = {}): string {
  let output = applyA4DocumentLayout(html);
  output = injectStyles(output, A4_PREVIEW_STYLES + PREVIEW_TOOLBAR_STYLES);
  output = injectAfterBodyOpen(output, buildToolbarHtml(options));
  output = injectBeforeBodyClose(output, `<script>${A4_PRINT_SCRIPT}</script>`);
  return output;
}
