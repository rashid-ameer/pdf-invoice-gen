/** Group 7 QR HTML helper. Full verification lives in verification.server.ts (Group 13). */
export interface DocumentVerificationPayload {
  qrDataUrl: string;
  verifyUrl: string;
  integrityCode: string;
}

export function buildVerificationQrHtml(
  visible: boolean,
  verification?: DocumentVerificationPayload | null,
): string {
  if (!visible || !verification?.qrDataUrl) return "";
  return `<div class="verification-qr" data-section="verification_qr">
    <img src="${verification.qrDataUrl}" alt="Verify document authenticity" width="96" height="96" />
    <div class="verification-qr-caption">
      <strong>Scan to verify</strong>
      <span class="verification-code">${verification.integrityCode}</span>
    </div>
  </div>`;
}
