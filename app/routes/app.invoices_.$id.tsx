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
  getInvoiceDetailsForShop,
  renderInvoiceDocument,
} from "../models/invoice-document.server";
import { formatPaymentStatus } from "../utils/csv";
import { downloadInvoicePdf } from "../utils/download-invoice-pdf";
import {
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import { printInvoiceHtml } from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/** `/app/invoices/:id` only — not list, view, download, export, or bulk. */
function isInvoiceDetailsPath(pathname: string): boolean {
  return /^\/app\/invoices\/[^/]+$/.test(pathname);
}
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = String(params.id ?? "").trim();
  if (!invoiceId) {
    return {
      invoice: null as Awaited<ReturnType<typeof getInvoiceDetailsForShop>>,
      previewHtml: null as string | null,
    };
  }

  const invoice = await getInvoiceDetailsForShop(session.shop, invoiceId);
  if (!invoice) {
    return { invoice: null, previewHtml: null };
  }

  // Same G5/G7 render path as view/PDF — embedded via srcDoc to avoid nested
  // iframe auth failures inside the Shopify admin app frame.
  const doc = await renderInvoiceDocument(session.shop, invoice.id);
  const previewHtml = doc ? wrapA4EmbedHtml(doc.html) : null;

  return { invoice, previewHtml };
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

const MORE_MENU_ID = "invoice-details-more-actions";

export default function InvoiceDetailsPage() {
  const { invoice, previewHtml } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  // Shopify: host Loading API for route transitions; section spinners only while
  // this page's content is pending. Do not blank already-loaded UI when leaving.
  const loadingDetailsContent =
    navigation.state !== "idle" &&
    navigation.location != null &&
    isInvoiceDetailsPath(navigation.location.pathname);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setPreviewLoaded(false);
  }, [invoice?.id, previewHtml]);

  // Host-level indicator only while navigating to (or reloading) details.
  useEffect(() => {
    if (!loadingDetailsContent) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetailsContent, shopify]);

  const fitPreview = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) {
      setPreviewLoaded(true);
      return;
    }
    const contentWidth = Math.max(doc.body.scrollWidth, 1);
    const frameWidth = Math.max(iframe.clientWidth, 1);
    const scale = Math.min(1, frameWidth / contentWidth);
    doc.body.style.transformOrigin = "top left";
    doc.body.style.transform = scale < 1 ? `scale(${scale})` : "";
    const scaledHeight = Math.ceil(doc.body.scrollHeight * scale) + 24;
    iframe.height = String(Math.max(scaledHeight, 320));
    setPreviewLoaded(true);
  };

  if (!invoice) {
    return (
      <s-page heading="Invoice not found">
        <s-link slot="breadcrumb-actions" href="/app/invoices">
          Invoices
        </s-link>
        <s-section accessibilityLabel="Invoice not found">
          <s-stack gap="base">
            <s-banner tone="critical" heading="Invoice not found">
              This invoice could not be loaded. It may have been deleted or does
              not belong to this store.
            </s-banner>
            <s-button variant="primary" href="/app/invoices">
              Back to Invoices
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const paymentLabel = formatPaymentStatus(invoice.financialStatus);
  const actionsReady = !loadingDetailsContent;
  const sideLoading = loadingDetailsContent;
  const previewLoading = loadingDetailsContent || !previewLoaded;
  const previewMissing = !previewHtml;

  const copyInvoiceNumber = async () => {
    try {
      await navigator.clipboard.writeText(invoice.invoiceNumber);
      shopify.toast.show(`Copied ${invoice.invoiceNumber}`);
    } catch {
      shopify.toast.show("Could not copy invoice number", { isError: true });
    }
  };

  /**
   * Native browser print of the same G5/G7 HTML already in the preview iframe.
   * Stays on this page — no PDF download, toast, or app navigation.
   */
  const printInvoice = () => {
    if (!previewHtml) return;
    printInvoiceHtml(previewHtml, {
      iframe: iframeRef.current,
      iframeReady: previewLoaded,
    });
  };

  const openDownload = async () => {
    if (!invoice || downloading) return;
    setDownloading(true);
    try {
      await downloadInvoicePdf({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        onError: (message) => {
          shopify.toast.show(message, { isError: true });
        },
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <s-page heading={invoice.invoiceNumber}>
      <s-link slot="breadcrumb-actions" href="/app/invoices">
        Invoices
      </s-link>

      {paymentLabel ? (
        <s-badge
          slot="accessory"
          tone={paymentStatusBadgeTone(invoice.financialStatus)}
        >
          {paymentLabel}
        </s-badge>
      ) : null}
      <s-badge
        slot="accessory"
        tone={invoiceStatusBadgeTone(invoice.status)}
      >
        {formatInvoiceStatusLabel(invoice.status)}
      </s-badge>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled
        accessibilityLabel="Send email is not available yet"
      >
        Send email
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        commandFor={MORE_MENU_ID}
        {...(!actionsReady ? { disabled: true } : {})}
      >
        More actions
      </s-button>
      <s-menu
        id={MORE_MENU_ID}
        accessibilityLabel={`More actions for ${invoice.invoiceNumber}`}
      >
        <s-button icon="clipboard" onClick={() => void copyInvoiceNumber()}>
          Copy
        </s-button>
        <s-button icon="print" onClick={printInvoice}>
          Print
        </s-button>
        <s-button
          icon="download"
          onClick={() => void openDownload()}
          {...(downloading ? { loading: true, disabled: true } : {})}
        >
          Download
        </s-button>
      </s-menu>

      <s-section heading="Invoice" accessibilityLabel="Invoice document preview">
        <s-stack gap="small">
          {previewLoading && !previewMissing ? (
            <s-stack gap="small" alignItems="center">
              <s-spinner accessibilityLabel="Loading invoice document" />
              <s-text color="subdued">Loading invoice document…</s-text>
            </s-stack>
          ) : null}
          {previewMissing ? (
            <s-banner tone="critical" heading="Preview unavailable">
              The invoice document could not be rendered. Try Print or Download,
              or return to the invoices list.
            </s-banner>
          ) : (
            <s-box
              border="base"
              borderRadius="base"
              overflow="hidden"
              background="subdued"
            >
              {/*
                Hosts the same G5/G7 HTML used for print/PDF (via wrapA4EmbedHtml).
                srcDoc avoids nested-iframe auth failures in the embedded admin.
              */}
              <iframe
                ref={iframeRef}
                title={`Invoice ${invoice.invoiceNumber}`}
                srcDoc={previewHtml}
                width="100%"
                height="640"
                onLoad={fitPreview}
              />
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Summary">
        {sideLoading ? (
          <s-stack gap="small" alignItems="start">
            <s-spinner accessibilityLabel="Loading summary" />
          </s-stack>
        ) : (
          <s-stack gap="small">
            <s-stack gap="none">
              <s-text color="subdued">Customer</s-text>
              <s-text>{invoice.buyerName}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Order</s-text>
              {invoice.orderAdminUrl ? (
                <s-link href={invoice.orderAdminUrl} target="_blank">
                  {invoice.shopifyOrderNumber}
                </s-link>
              ) : (
                <s-text>{invoice.shopifyOrderNumber}</s-text>
              )}
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Invoice date</s-text>
              <s-text>{formatIssueDate(invoice.issueDateIso)}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Total</s-text>
              <s-text type="strong">
                {formatMoney(invoice.grandTotal, invoice.currency)}
              </s-text>
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
