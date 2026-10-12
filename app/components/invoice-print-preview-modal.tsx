/**
 * Invoices list print preview — keeps the stable modal id used by
 * `shopify.modal.show(INVOICE_PRINT_PREVIEW_MODAL_ID)`.
 */
import type { ComponentProps } from "react";

import {
  DocumentPrintPreviewModal,
  DOCUMENT_PRINT_PREVIEW_MODAL_ID,
  INVOICE_PRINT_PREVIEW_MODAL_ID,
} from "./document-print-preview-modal";

export {
  DocumentPrintPreviewModal,
  DOCUMENT_PRINT_PREVIEW_MODAL_ID,
  INVOICE_PRINT_PREVIEW_MODAL_ID,
};

type InvoicePrintPreviewModalProps = Omit<
  ComponentProps<typeof DocumentPrintPreviewModal>,
  "id"
> & {
  id?: string;
};

export function InvoicePrintPreviewModal({
  id = INVOICE_PRINT_PREVIEW_MODAL_ID,
  ...props
}: InvoicePrintPreviewModalProps) {
  return <DocumentPrintPreviewModal id={id} {...props} />;
}
