/**
 * Public verification result HTML page.
 * Port of `uae-invoiceing-app/server/views/document-verification.ts`.
 */

import type {
  VerificationDocumentKind,
  VerificationResult,
} from "./verification.server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function documentTitle(kind: VerificationDocumentKind): string {
  if (kind === "credit_note") return "Credit Note Verification";
  if (kind === "refund_document") return "Refund Document Verification";
  return "Invoice Verification";
}

export function renderDocumentVerificationPage(
  result: VerificationResult,
): string {
  if (!result.ok) {
    const message =
      result.reason === "invalid_link"
        ? "This verification link is invalid or has been tampered with."
        : "The document could not be found.";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verification failed</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f6f6f7;
      color: #202223;
      padding: 24px;
    }
    .card {
      width: min(480px, 100%);
      background: #fff;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 8px 14px;
      border-radius: 999px;
      background: #fdecec;
      color: #b42318;
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 16px;
    }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    p { margin: 0; color: #616161; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Invalid</div>
    <h1>Verification failed</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
  }

  const title = documentTitle(result.kind);
  const statusLabel = result.authentic
    ? "Verified authentic"
    : "Document modified";
  const statusClass = result.authentic ? "ok" : "warn";
  const statusHint = result.authentic
    ? "This document matches the record issued by the merchant."
    : "The document details no longer match the sealed integrity record.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(180deg, #f6f6f7 0%, #eef2f1 100%);
      color: #202223;
      padding: 32px 16px;
    }
    .wrap { max-width: 640px; margin: 0 auto; }
    .card {
      background: #fff;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 18px;
    }
    .badge.ok { background: #e3f1df; color: #108043; }
    .badge.warn { background: #fff4e5; color: #b76e00; }
    h1 { margin: 0 0 6px; font-size: 1.6rem; }
    .hint { margin: 0 0 24px; color: #616161; line-height: 1.5; }
    .grid {
      display: grid;
      gap: 12px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid #ececec;
      font-size: 14px;
    }
    .row:last-child { border-bottom: 0; }
    .label { color: #6d7175; }
    .value { font-weight: 600; text-align: right; }
    .code {
      margin-top: 20px;
      padding: 14px 16px;
      border-radius: 12px;
      background: #f6f6f7;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0.08em;
      text-align: center;
      font-weight: 700;
    }
    .footer {
      margin-top: 18px;
      font-size: 12px;
      color: #8c9196;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge ${statusClass}">${escapeHtml(statusLabel)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="hint">${escapeHtml(statusHint)}</p>
      <div class="grid">
        <div class="row"><span class="label">Merchant</span><span class="value">${escapeHtml(result.storeName)}</span></div>
        <div class="row"><span class="label">Document</span><span class="value">${escapeHtml(result.documentNumber)}</span></div>
        <div class="row"><span class="label">Issue date</span><span class="value">${escapeHtml(result.issueDate)}</span></div>
        <div class="row"><span class="label">Seller</span><span class="value">${escapeHtml(result.sellerName)}</span></div>
        <div class="row"><span class="label">Buyer</span><span class="value">${escapeHtml(result.buyerName)}</span></div>
        <div class="row"><span class="label">Total</span><span class="value">${escapeHtml(result.grandTotal)}</span></div>
        <div class="row"><span class="label">Status</span><span class="value">${escapeHtml(result.status)}</span></div>
      </div>
      <div class="code">Integrity ${escapeHtml(result.integrityCode)}</div>
      <div class="footer">Powered by document verification · ${escapeHtml(result.currency)}</div>
    </div>
  </div>
</body>
</html>`;
}

export function verificationHttpResponse(result: VerificationResult): Response {
  return new Response(renderDocumentVerificationPage(result), {
    status: result.ok ? 200 : 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
