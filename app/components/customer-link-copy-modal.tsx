import { useAppBridge } from "@shopify/app-bridge-react";

import { copyTextToClipboard } from "../utils/clipboard";

export const CUSTOMER_LINK_MODAL_ID = "customer-link-copy-modal";

type CustomerLinkCopyModalProps = {
  id?: string;
  /** Generated public URL; empty until Generate succeeds. */
  url: string;
  generating: boolean;
  error?: string | null;
  onGenerate: () => void;
  onHide?: () => void;
};

/**
 * Opens instantly from the menu. Generate runs inside the modal; Copy is only
 * shown after the link exists (clipboard needs a user gesture).
 */
export function CustomerLinkCopyModal({
  id = CUSTOMER_LINK_MODAL_ID,
  url,
  generating,
  error = null,
  onGenerate,
  onHide,
}: CustomerLinkCopyModalProps) {
  const shopify = useAppBridge();
  const ready = Boolean(url) && !generating;

  const copyFromModal = async () => {
    if (!url) return;
    const copied = await copyTextToClipboard(url);
    if (copied) {
      shopify.toast.show("Customer link copied");
      return;
    }
    shopify.toast.show("Could not copy link", { isError: true });
  };

  const closeModal = () => {
    void shopify.modal.hide(id);
    onHide?.();
  };

  return (
    <s-modal
      id={id}
      heading="Customer link"
      onHide={() => {
        onHide?.();
      }}
    >
      <s-stack gap="base">
        {error ? (
          <s-banner tone="critical" heading="Couldn't create link">
            {error}
          </s-banner>
        ) : null}

        {ready ? (
          <>
            <s-text-field label="Link" value={url} readOnly />
            <s-text color="subdued">
              Use the copy button to share this URL with your customer.
            </s-text>
          </>
        ) : (
          <s-text color="subdued">
            Generate a customer link, then copy it to share outside the admin.
          </s-text>
        )}
      </s-stack>

      {ready ? (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            icon="clipboard"
            accessibilityLabel="Copy link"
            onClick={() => void copyFromModal()}
          >
            Copy link
          </s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={closeModal}
          >
            Close
          </s-button>
        </>
      ) : (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            icon="link"
            onClick={onGenerate}
            {...(generating ? { loading: true, disabled: true } : {})}
          >
            Generate
          </s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={closeModal}
            {...(generating ? { disabled: true } : {})}
          >
            Close
          </s-button>
        </>
      )}
    </s-modal>
  );
}
