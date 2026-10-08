import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  CUSTOMER_LINK_MODAL_ID,
  CustomerLinkCopyModal,
} from "../components/customer-link-copy-modal";
import { APP_LOCALE } from "../constants/app";
import { sendInvoiceEmail } from "../models/document-email.server";
import { wrapA4EmbedHtml } from "../models/document-preview.server";
import {
  getInvoiceDetailsForShop,
  renderInvoiceDocument,
} from "../models/invoice-document.server";
import { issueInvoicePublicLinkForShop } from "../models/public-link.server";
import { formatPaymentStatus } from "../utils/csv";
import { downloadInvoicePdf } from "../utils/download-invoice-pdf";
import { paymentStatusBadgeTone } from "../utils/invoice-status-badges";
import { printInvoiceHtml } from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/** Preview + sticky Summary; stack on narrow containers. */
const DETAIL_LAYOUT_COLS =
  "@container (inline-size > 900px) 1.5fr 0.75fr, 1fr";

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

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "send-email") {
    const invoiceId = String(params.id ?? formData.get("documentId") ?? "").trim();
    if (!invoiceId) {
      return {
        ok: false as const,
        intent: "send-email" as const,
        error: "Invoice not found",
      };
    }
    const result = await sendInvoiceEmail({
      shop: session.shop,
      invoiceId,
      trigger: "manual",
    });
    if (!result.ok) {
      return {
        ok: false as const,
        intent: "send-email" as const,
        error: result.error || "Failed to send email",
        to: result.to,
      };
    }
    return {
      ok: true as const,
      intent: "send-email" as const,
      to: result.to,
      message: `Email sent to ${result.to}`,
    };
  }

  if (intent === "customer-link") {
    const invoiceId = String(params.id ?? formData.get("documentId") ?? "").trim();
    if (!invoiceId) {
      return {
        ok: false as const,
        intent: "customer-link" as const,
        error: "Invoice not found",
      };
    }
    const result = await issueInvoicePublicLinkForShop(session.shop, invoiceId);
    if (!result) {
      return {
        ok: false as const,
        intent: "customer-link" as const,
        error: "Invoice not found",
      };
    }
    return {
      ok: true as const,
      intent: "customer-link" as const,
      url: result.url,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  return {
    ok: false as const,
    intent: "unknown" as const,
    error: "Unknown action",
  };
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
  const emailFetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
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
  const [customerLinkUrl, setCustomerLinkUrl] = useState("");
  const [customerLinkError, setCustomerLinkError] = useState<string | null>(
    null,
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const emailAwaiting = useRef(false);
  const emailDataAtSubmit = useRef(emailFetcher.data);
  const emailSending =
    emailFetcher.state === "submitting" || emailFetcher.state === "loading";
  const linkAwaiting = useRef(false);
  const linkDataAtSubmit = useRef(linkFetcher.data);
  const linkGenerating =
    linkFetcher.state === "submitting" || linkFetcher.state === "loading";

  // Host-level indicator only while navigating to (or reloading) details.
  useEffect(() => {
    if (!loadingDetailsContent) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetailsContent, shopify]);

  useEffect(() => {
    if (!emailAwaiting.current || emailFetcher.state !== "idle") return;
    emailAwaiting.current = false;

    if (!emailFetcher.data || emailFetcher.data === emailDataAtSubmit.current) {
      shopify.toast.show("Couldn't send", { isError: true });
      return;
    }

    if (emailFetcher.data.intent !== "send-email") return;

    if (emailFetcher.data.ok) {
      shopify.toast.show(emailFetcher.data.message);
      return;
    }

    shopify.toast.show(emailFetcher.data.error || "Failed to send email", {
      isError: true,
    });
  }, [emailFetcher.state, emailFetcher.data, shopify]);

  useEffect(() => {
    if (!linkAwaiting.current || linkFetcher.state !== "idle") return;
    linkAwaiting.current = false;

    if (!linkFetcher.data || linkFetcher.data === linkDataAtSubmit.current) {
      setCustomerLinkError("Failed to create link");
      return;
    }

    if (linkFetcher.data.intent !== "customer-link") return;

    if (
      !linkFetcher.data.ok ||
      !("url" in linkFetcher.data) ||
      !linkFetcher.data.url
    ) {
      setCustomerLinkError(
        ("error" in linkFetcher.data && linkFetcher.data.error) ||
          "Failed to create link",
      );
      return;
    }

    setCustomerLinkError(null);
    setCustomerLinkUrl(linkFetcher.data.url);
  }, [linkFetcher.state, linkFetcher.data]);

  /**
   * Mark the preview ready once the srcDoc iframe has laid out.
   * On hard refresh, iframe `load` can fire before React attaches onLoad, and a
   * separate "reset loaded" effect would leave the spinner stuck forever.
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
      // Iframe not in the DOM yet — attach on next frame after paint.
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
          // ignore cross-origin edge cases
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
      // Hard refresh: document may already be complete before this effect runs.
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
  }, [invoice?.id, previewHtml]);

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

  const sendEmail = () => {
    if (!invoice || emailSending) return;
    emailDataAtSubmit.current = emailFetcher.data;
    emailAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "send-email");
    body.set("documentId", invoice.id);
    emailFetcher.submit(body, { method: "post" });
  };

  const openCustomerLinkModal = () => {
    setCustomerLinkUrl("");
    setCustomerLinkError(null);
    void shopify.modal.show(CUSTOMER_LINK_MODAL_ID);
  };

  const generateCustomerLink = () => {
    if (!invoice || linkGenerating) return;
    setCustomerLinkError(null);
    setCustomerLinkUrl("");
    linkDataAtSubmit.current = linkFetcher.data;
    linkAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "customer-link");
    body.set("documentId", invoice.id);
    linkFetcher.submit(body, { method: "post" });
  };

  const resetCustomerLinkModal = () => {
    setCustomerLinkUrl("");
    setCustomerLinkError(null);
  };

  return (
    <s-page heading={invoice.invoiceNumber}>
      <s-link slot="breadcrumb-actions" href="/app/invoices">
        Invoices
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        icon="email"
        onClick={sendEmail}
        {...(emailSending
          ? { loading: true, disabled: true }
          : !actionsReady
            ? { disabled: true }
            : {})}
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
        <s-button icon="link" onClick={openCustomerLinkModal}>
          Generate customer link
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

      <s-query-container>
        <s-grid
          gridTemplateColumns={DETAIL_LAYOUT_COLS}
          gap="large"
          alignItems="start"
        >
          <s-section
            heading="Invoice"
            accessibilityLabel="Invoice document preview"
          >
            <s-stack gap="small">
              {previewLoading && !previewMissing ? (
                <s-stack gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Loading invoice document" />
                  <s-text color="subdued">Loading invoice document…</s-text>
                </s-stack>
              ) : null}
              {previewMissing ? (
                <s-banner tone="critical" heading="Preview unavailable">
                  The invoice document could not be rendered. Try Print or
                  Download, or return to the invoices list.
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
                    <s-text>{invoice.buyerName}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Order</s-text>
                    <s-text>{invoice.shopifyOrderNumber}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Invoice date</s-text>
                    <s-text>{formatIssueDate(invoice.issueDateIso)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Payment status</s-text>
                    {paymentLabel ? (
                      <s-badge
                        tone={paymentStatusBadgeTone(invoice.financialStatus)}
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
                      {formatMoney(invoice.grandTotal, invoice.currency)}
                    </s-text>
                  </s-stack>
                </s-stack>
              )}
            </s-section>
          </div>
        </s-grid>
      </s-query-container>

      <CustomerLinkCopyModal
        url={customerLinkUrl}
        generating={linkGenerating}
        error={customerLinkError}
        onGenerate={generateCustomerLink}
        onHide={resetCustomerLinkModal}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
