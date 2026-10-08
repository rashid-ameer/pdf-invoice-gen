import { useEffect, useRef, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { APP_LOCALE } from "../constants/app";
import { wrapA4EmbedHtml } from "../models/document-preview.server";
import {
  getPackingSlipDetailsForShop,
  renderPackingSlipDocument,
} from "../models/invoice-document.server";
import { formatPaymentStatus } from "../utils/csv";
import { downloadPackingSlipPdf } from "../utils/download-packing-slip-pdf";
import { paymentStatusBadgeTone } from "../utils/invoice-status-badges";
import { printInvoiceHtml } from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/** Preview + sticky Summary; stack on narrow containers. */
const DETAIL_LAYOUT_COLS =
  "@container (inline-size > 900px) 1.5fr 0.75fr, 1fr";

/** `/app/packing-slips/:id` only — not list or CSV export. */
function isPackingSlipDetailsPath(pathname: string): boolean {
  return /^\/app\/packing-slips\/[^/]+$/.test(pathname);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "").trim();
  if (!invoiceId) {
    return {
      packingSlip: null as Awaited<
        ReturnType<typeof getPackingSlipDetailsForShop>
      >,
      previewHtml: null as string | null,
    };
  }

  const packingSlip = await getPackingSlipDetailsForShop(
    session.shop,
    invoiceId,
  );
  if (!packingSlip) {
    return { packingSlip: null, previewHtml: null };
  }

  // Same G5/G7 packing-slip path as Phase 2 view/PDF — srcDoc avoids nested
  // iframe auth failures inside the Shopify admin app frame.
  const doc = await renderPackingSlipDocument(session.shop, packingSlip.id);
  const previewHtml = doc ? wrapA4EmbedHtml(doc.html) : null;

  return { packingSlip, previewHtml };
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(APP_LOCALE, {
      style: "currency",
      currency: currency || "AED",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatIssueDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PackingSlipDetailsPage() {
  const { packingSlip, previewHtml } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const loadingDetailsContent =
    navigation.state !== "idle" &&
    navigation.location != null &&
    isPackingSlipDetailsPath(navigation.location.pathname);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!loadingDetailsContent) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetailsContent, shopify]);

  /**
   * Mark the preview ready once the srcDoc iframe has laid out.
   * Same race-safe pattern as Invoice Details.
   */
  useEffect(() => {
    if (!previewHtml) {
      setPreviewLoaded(true);
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
  }, [packingSlip?.id, previewHtml]);

  if (!packingSlip) {
    return (
      <s-page heading="Packing slip not found">
        <s-link slot="breadcrumb-actions" href="/app/packing-slips">
          Packing slips
        </s-link>
        <s-section accessibilityLabel="Packing slip not found">
          <s-stack gap="base">
            <s-banner tone="critical" heading="Packing slip not found">
              This packing slip could not be loaded. It may have been deleted or
              does not belong to this store.
            </s-banner>
            <s-button variant="primary" href="/app/packing-slips">
              Back to Packing slips
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const paymentLabel = formatPaymentStatus(packingSlip.financialStatus);
  const actionsReady = !loadingDetailsContent;
  const sideLoading = loadingDetailsContent;
  const previewLoading = loadingDetailsContent || !previewLoaded;
  const previewMissing = !previewHtml;

  const printPackingSlip = () => {
    if (!previewHtml) return;
    printInvoiceHtml(previewHtml, {
      iframe: iframeRef.current,
      iframeReady: previewLoaded,
    });
  };

  const openDownload = async () => {
    if (!packingSlip || downloading) return;
    setDownloading(true);
    try {
      await downloadPackingSlipPdf({
        invoiceId: packingSlip.id,
        orderNumber: packingSlip.shopifyOrderNumber,
        invoiceNumber: packingSlip.invoiceNumber,
        onError: (message) => {
          shopify.toast.show(message, { isError: true });
        },
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <s-page heading={packingSlip.invoiceNumber}>
      <s-link slot="breadcrumb-actions" href="/app/packing-slips">
        Packing slips
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        icon="print"
        onClick={printPackingSlip}
        {...(!actionsReady || previewMissing ? { disabled: true } : {})}
      >
        Print
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        icon="download"
        onClick={() => void openDownload()}
        {...(downloading
          ? { loading: true, disabled: true }
          : !actionsReady
            ? { disabled: true }
            : {})}
      >
        Download
      </s-button>

      <s-query-container>
        <s-grid
          gridTemplateColumns={DETAIL_LAYOUT_COLS}
          gap="large"
          alignItems="start"
        >
          <s-section
            heading="Packing slip"
            accessibilityLabel="Packing slip document preview"
          >
            <s-stack gap="small">
              {previewLoading && !previewMissing ? (
                <s-stack gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Loading packing slip document" />
                  <s-text color="subdued">Loading packing slip document…</s-text>
                </s-stack>
              ) : null}
              {previewMissing ? (
                <s-banner tone="critical" heading="Preview unavailable">
                  The packing slip document could not be rendered. Try Print or
                  Download, or return to the packing slips list.
                </s-banner>
              ) : (
                <s-box
                  border="base"
                  borderRadius="base"
                  overflow="hidden"
                  background="subdued"
                >
                  {/*
                    Hosts the same G5/G7 packing-slip HTML used for print/PDF
                    (via wrapA4EmbedHtml). srcDoc avoids nested-iframe auth issues.
                  */}
                  <iframe
                    ref={iframeRef}
                    title={`Packing slip ${packingSlip.invoiceNumber}`}
                    srcDoc={previewHtml}
                    width="100%"
                    height="640"
                  />
                </s-box>
              )}
            </s-stack>
          </s-section>

          <div style={{ position: "sticky", top: "1rem", alignSelf: "start" }}>
            <s-section heading="Summary">
              {sideLoading ? (
                <s-stack gap="small" alignItems="start">
                  <s-spinner accessibilityLabel="Loading summary" />
                </s-stack>
              ) : (
                <s-stack gap="small">
                  <s-stack gap="none">
                    <s-text color="subdued">Customer</s-text>
                    <s-text>{packingSlip.buyerName}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Order</s-text>
                    <s-text>{packingSlip.shopifyOrderNumber}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Invoice date</s-text>
                    <s-text>{formatIssueDate(packingSlip.issueDateIso)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Payment status</s-text>
                    {paymentLabel ? (
                      <s-badge
                        tone={paymentStatusBadgeTone(packingSlip.financialStatus)}
                      >
                        {paymentLabel}
                      </s-badge>
                    ) : (
                      <s-text>—</s-text>
                    )}
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Total</s-text>
                    <s-text type="strong">
                      {formatMoney(packingSlip.grandTotal, packingSlip.currency)}
                    </s-text>
                  </s-stack>
                </s-stack>
              )}
            </s-section>
          </div>
        </s-grid>
      </s-query-container>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
