import {useEffect, useRef} from 'react';

import {usePolarisModalHide} from '../hooks/use-polaris-modal-hide';

type ModalElement = HTMLElement & {
  showOverlay: () => void;
  hideOverlay: () => void;
};

export function ConfirmModal({
  id,
  open,
  heading,
  message,
  confirmLabel = 'Delete',
  onCancel,
  onConfirm,
  loading = false,
}: {
  id: string;
  open: boolean;
  heading: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const wasOpen = useRef(false);
  usePolarisModalHide(id, onCancel);

  useEffect(() => {
    const modal = document.getElementById(id) as ModalElement | null;
    if (!modal) return;
    if (open) {
      modal.showOverlay();
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) {
      modal.hideOverlay();
      wasOpen.current = false;
    }
  }, [id, open]);

  return (
    <s-modal
      id={id}
      heading={heading}
      size="small"
      accessibilityLabel={heading}
    >
      <s-paragraph>{message}</s-paragraph>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        commandFor={id}
        command="--hide"
        disabled={loading}
        onClick={onCancel}
      >
        Cancel
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={loading}
        disabled={loading}
        onClick={onConfirm}
      >
        {confirmLabel}
      </s-button>
    </s-modal>
  );
}
