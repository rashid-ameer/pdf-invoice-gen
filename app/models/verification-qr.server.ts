/** Group 13 will own full verification. Group 7 only needs QR HTML when payload is present. */
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
