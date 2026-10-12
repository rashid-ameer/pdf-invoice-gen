/**
 * List Send email flow: open instantly from the row menu, then Send runs inside
 * the modal so loading / errors stay visible (same pattern as customer link).
 */
import { useAppBridge } from "@shopify/app-bridge-react";

import { usePolarisModalHide } from "../hooks/use-polaris-modal-hide";

export const SEND_DOCUMENT_EMAIL_MODAL_ID = "send-document-email-modal";

type SendDocumentEmailModalProps = {
  id?: string;
  heading?: string;
  /** Document number shown in helper copy (e.g. INV-1001). */
  documentLabel?: string;
  /** Buyer email from the list row; empty when unknown. */
  recipientEmail?: string;
  sending: boolean;
  error?: string | null;
  onSend: () => void;
  onHide?: () => void;
};

export function SendDocumentEmailModal({
  id = SEND_DOCUMENT_EMAIL_MODAL_ID,
  heading = "Send email",
  documentLabel = "",
  recipientEmail = "",
  sending,
  error = null,
  onSend,
  onHide,
}: SendDocumentEmailModalProps) {
  const shopify = useAppBridge();
  usePolarisModalHide(id, onHide);

  const closeModal = () => {
    if (sending) return;
    void shopify.modal.hide(id);
  };

  return (
    <s-modal id={id} heading={heading}>
      <s-stack gap="base">
        {error ? (
          <s-banner tone="critical" heading="Couldn't send email">
            {error}
          </s-banner>
        ) : null}

        <s-text color="subdued">
          {documentLabel
            ? `Send ${documentLabel} to the customer using your email template and PDF.`
            : "Send this document to the customer using your email template and PDF."}
        </s-text>

        {recipientEmail ? (
          <s-text-field label="Recipient" value={recipientEmail} readOnly />
        ) : (
          <s-banner tone="warning" heading="No customer email">
            This document has no buyer email. Sending may fail until an email is
            available on the order.
          </s-banner>
        )}
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        icon="email"
        onClick={onSend}
        {...(sending ? { loading: true, disabled: true } : {})}
      >
        Send
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={closeModal}
        {...(sending ? { disabled: true } : {})}
      >
        Cancel
      </s-button>
    </s-modal>
  );
}
