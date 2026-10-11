/**
 * Invoices list print flow: large modal with document preview + Print.
 * Native print runs from the visible preview iframe (same page; no new tab).
 */
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

import { printInvoiceHtml } from "../utils/print-invoice-document";

export const INVOICE_PRINT_PREVIEW_MODAL_ID = "invoice-print-preview-modal";

type InvoicePrintPreviewModalProps = {
  id?: string;
  heading: string;
  html: string | null;
  loading: boolean;
  error: string | null;
  onHide?: () => void;
};

export function InvoicePrintPreviewModal({
  id = INVOICE_PRINT_PREVIEW_MODAL_ID,
  heading,
  html,
  loading,
  error = null,
  onHide,
}: InvoicePrintPreviewModalProps) {
  const shopify = useAppBridge();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  useEffect(() => {
    if (!html) {
      setPreviewLoaded(false);
      return;
    }

    setPreviewLoaded(false);
    let cancelled = false;
    let finished = false;

    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (iframe && doc?.body) {
        const contentWidth = Math.max(doc.body.scrollWidth, 1);
        const frameWidth = Math.max(iframe.clientWidth, 1);
        const scale = Math.min(1, frameWidth / contentWidth);
        doc.body.style.transformOrigin = "top left";
        doc.body.style.transform = scale < 1 ? `scale(${scale})` : "";
        const scaledHeight = Math.ceil(doc.body.scrollHeight * scale) + 24;
        iframe.height = String(Math.max(scaledHeight, 320));
      }
      setPreviewLoaded(true);
    };

    const iframe = iframeRef.current;
    if (!iframe) {
      let el: HTMLIFrameElement | null = null;
      const raf = requestAnimationFrame(() => {
        el = iframeRef.current;
        if (!el) {
          finish();
          return;
        }
        el.addEventListener("load", finish);
        try {
          if (el.contentDocument?.readyState === "complete") finish();
        } catch {
          // ignore
        }
      });
      const timer = window.setTimeout(finish, 2000);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        el?.removeEventListener("load", finish);
      };
    }

    iframe.addEventListener("load", finish);
    try {
      if (iframe.contentDocument?.readyState === "complete") {
        finish();
      }
    } catch {
      // ignore
    }
    const timer = window.setTimeout(finish, 2000);

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", finish);
      window.clearTimeout(timer);
    };
  }, [html]);

  const closeModal = () => {
    void shopify.modal.hide(id);
    onHide?.();
  };

  const printDocument = () => {
    if (!html || !previewLoaded) return;
    printInvoiceHtml(html, {
      iframe: iframeRef.current,
      iframeReady: previewLoaded,
      allowDedicatedTab: false,
    });
  };

  const canPrint = Boolean(html) && previewLoaded && !loading && !error;

  return (
    <s-modal
      id={id}
      heading={heading}
      size="large"
      accessibilityLabel={heading}
      onHide={() => {
        onHide?.();
      }}
    >
      <s-stack gap="base">
        {error ? (
          <s-banner tone="critical" heading="Preview unavailable">
            {error}
          </s-banner>
        ) : null}

        {loading ? (
          <s-stack gap="small" alignItems="center" padding="large">
            <s-spinner accessibilityLabel="Loading invoice preview" />
            <s-text color="subdued">Loading preview…</s-text>
          </s-stack>
        ) : null}

        {!loading && html && !error ? (
          <s-box
            border="base"
            borderRadius="base"
            overflow="hidden"
            background="subdued"
          >
            <iframe
              ref={iframeRef}
              title={heading}
              srcDoc={html}
              width="100%"
              height="640"
            />
          </s-box>
        ) : null}
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        icon="print"
        onClick={printDocument}
        {...(!canPrint ? { disabled: true } : {})}
      >
        Print
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={closeModal}
      >
        Close
      </s-button>
    </s-modal>
  );
}
