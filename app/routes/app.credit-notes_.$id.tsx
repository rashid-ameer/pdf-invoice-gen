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

import { APP_LOCALE } from "../constants/app";
import { sendCreditNoteEmail } from "../models/document-email.server";
import { wrapA4EmbedHtml } from "../models/document-preview.server";
import {
  getCreditNoteDetailsForShop,
  listCreditNoteTemplatesForShop,
  renderCreditNoteDocument,
} from "../models/credit-note-document.server";
import { issueCreditNotePublicLinkForShop } from "../models/public-link.server";
import { formatPaymentStatus } from "../utils/csv";
import { downloadCreditNotePdf } from "../utils/download-credit-note-pdf";
import {
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import { printInvoiceHtml } from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/** Preview + sticky Summary; stack on narrow containers. */
const DETAIL_LAYOUT_COLS =
  "@container (inline-size > 900px) 1.5fr 0.75fr, 1fr";

/** `/app/credit-notes/:id` only — not list, view, download, export, or bulk. */
function isCreditNoteDetailsPath(pathname: string): boolean {
  return /^\/app\/credit-notes\/[^/]+$/.test(pathname);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const creditNoteId = String(params.id ?? "").trim();
  const url = new URL(request.url);
  const templateId =
    url.searchParams.get("templateId") ??
    url.searchParams.get("template") ??
    undefined;

  type TemplateOption = NonNullable<
    Awaited<ReturnType<typeof listCreditNoteTemplatesForShop>>
  >;

  if (!creditNoteId) {
    return {
      creditNote: null as Awaited<
        ReturnType<typeof getCreditNoteDetailsForShop>
      >,
      previewHtml: null as string | null,
      templates: [] as TemplateOption,
      selectedTemplateId: null as string | null,
    };
  }

  const [creditNote, templatesResult] = await Promise.all([
    getCreditNoteDetailsForShop(session.shop, creditNoteId),
    listCreditNoteTemplatesForShop(session.shop),
  ]);
  const templates: TemplateOption = templatesResult ?? [];
  if (!creditNote) {
    return {
      creditNote: null,
      previewHtml: null,
      templates,
      selectedTemplateId: null,
    };
  }

  const defaultTemplateId =
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? null;
  const resolvedTemplateId = templateId || defaultTemplateId || undefined;

  const doc = await renderCreditNoteDocument(
    session.shop,
    creditNote.id,
    resolvedTemplateId,
  );
  const previewHtml = doc ? wrapA4EmbedHtml(doc.html) : null;

  return {
    creditNote,
    previewHtml,
    templates,
    selectedTemplateId: doc?.templateId ?? resolvedTemplateId ?? null,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "send-email") {
    const creditNoteId = String(
      params.id ?? formData.get("documentId") ?? "",
    ).trim();
    if (!creditNoteId) {
      return {
        ok: false as const,
        intent: "send-email" as const,
        error: "Credit note not found",
      };
    }
    const result = await sendCreditNoteEmail({
      shop: session.shop,
      creditNoteId,
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
    const creditNoteId = String(
      params.id ?? formData.get("documentId") ?? "",
    ).trim();
    if (!creditNoteId) {
      return {
        ok: false as const,
        intent: "customer-link" as const,
        error: "Credit note not found",
      };
    }
    const result = await issueCreditNotePublicLinkForShop(
      session.shop,
      creditNoteId,
      "credit_note",
    );
    if (!result) {
      return {
        ok: false as const,
        intent: "customer-link" as const,
        error: "Credit note not found",
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

const MORE_MENU_ID = "credit-note-details-more-actions";

export default function CreditNoteDetailsPage() {
  const { creditNote, previewHtml, selectedTemplateId } =
    useLoaderData<typeof loader>();
  const emailFetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const loadingDetailsContent =
    navigation.state !== "idle" &&
    navigation.location != null &&
    isCreditNoteDetailsPath(navigation.location.pathname);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const emailAwaiting = useRef(false);
  const emailDataAtSubmit = useRef(emailFetcher.data);
  const emailSending =
    emailFetcher.state === "submitting" || emailFetcher.state === "loading";
  const linkAwaiting = useRef(false);
  const linkDataAtSubmit = useRef(linkFetcher.data);
  const linkCopying =
    linkFetcher.state === "submitting" || linkFetcher.state === "loading";

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
      shopify.toast.show("Failed to create link", { isError: true });
      return;
    }

    if (linkFetcher.data.intent !== "customer-link") return;

    if (!linkFetcher.data.ok || !("url" in linkFetcher.data) || !linkFetcher.data.url) {
      shopify.toast.show(
        ("error" in linkFetcher.data && linkFetcher.data.error) ||
          "Failed to create link",
        { isError: true },
      );
      return;
    }

    const url = linkFetcher.data.url;
    void navigator.clipboard.writeText(url).then(
      () => {
        shopify.toast.show("Customer link copied");
      },
      () => {
        window.open(url, "_blank", "noopener");
        shopify.toast.show("Link created — opened in a new tab");
      },
    );
  }, [linkFetcher.state, linkFetcher.data, shopify]);

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
  }, [creditNote?.id, previewHtml]);

  if (!creditNote) {
    return (
      <s-page heading="Credit note not found">
        <s-link slot="breadcrumb-actions" href="/app/credit-notes">
          Credit notes
        </s-link>
        <s-section accessibilityLabel="Credit note not found">
          <s-stack gap="base">
            <s-banner tone="critical" heading="Credit note not found">
              This credit note could not be loaded. It may have been deleted or
              does not belong to this store.
            </s-banner>
            <s-button variant="primary" href="/app/credit-notes">
              Back to Credit notes
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const paymentLabel = formatPaymentStatus(creditNote.financialStatus);
  const actionsReady = !loadingDetailsContent;
  const sideLoading = loadingDetailsContent;
  const previewLoading = loadingDetailsContent || !previewLoaded;
  const previewMissing = !previewHtml;

  const copyCreditNoteNumber = async () => {
    try {
      await navigator.clipboard.writeText(creditNote.creditNoteNumber);
      shopify.toast.show(`Copied ${creditNote.creditNoteNumber}`);
    } catch {
      shopify.toast.show("Could not copy credit note number", {
        isError: true,
      });
    }
  };

  const printCreditNote = () => {
    if (!previewHtml) return;
    printInvoiceHtml(previewHtml, {
      iframe: iframeRef.current,
      iframeReady: previewLoaded,
    });
  };

  const openDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadCreditNotePdf({
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.creditNoteNumber,
        templateId: selectedTemplateId ?? undefined,
        onError: (message) => {
          shopify.toast.show(message, { isError: true });
        },
      });
    } finally {
      setDownloading(false);
    }
  };

  const sendEmail = () => {
    if (emailSending) return;
    emailDataAtSubmit.current = emailFetcher.data;
    emailAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "send-email");
    body.set("documentId", creditNote.id);
    emailFetcher.submit(body, { method: "post" });
  };

  const copyCustomerLink = () => {
    if (linkCopying) return;
    linkDataAtSubmit.current = linkFetcher.data;
    linkAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "customer-link");
    body.set("documentId", creditNote.id);
    linkFetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading={creditNote.creditNoteNumber}>
      <s-link slot="breadcrumb-actions" href="/app/credit-notes">
        Credit notes
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
        accessibilityLabel={`More actions for ${creditNote.creditNoteNumber}`}
      >
        <s-button icon="clipboard" onClick={() => void copyCreditNoteNumber()}>
          Copy
        </s-button>
        <s-button
          icon="link"
          onClick={copyCustomerLink}
          {...(linkCopying ? { loading: true, disabled: true } : {})}
        >
          Copy customer link
        </s-button>
        <s-button
          icon="print"
          onClick={printCreditNote}
          {...(previewMissing ? { disabled: true } : {})}
        >
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
            heading="Credit note"
            accessibilityLabel="Credit note document preview"
          >
            <s-stack gap="small">
              {previewLoading && !previewMissing ? (
                <s-stack gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Loading credit note document" />
                  <s-text color="subdued">Loading credit note document…</s-text>
                </s-stack>
              ) : null}
              {previewMissing ? (
                <s-banner tone="critical" heading="Preview unavailable">
                  The credit note document could not be rendered. Try Print or
                  Download, or return to the credit notes list.
                </s-banner>
              ) : (
                <s-box
                  border="base"
                  borderRadius="base"
                  overflow="hidden"
                  background="subdued"
                >
                  <iframe
                    ref={iframeRef}
                    title={`Credit note ${creditNote.creditNoteNumber}`}
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
                    <s-text>{creditNote.buyerName}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Invoice</s-text>
                    <s-text>{creditNote.originalInvoiceNumber}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Order</s-text>
                    <s-text>{creditNote.shopifyOrderNumber}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Issue date</s-text>
                    <s-text>{formatIssueDate(creditNote.issueDateIso)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Reason</s-text>
                    <s-text>{creditNote.reason || "—"}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Status</s-text>
                    <s-badge tone={invoiceStatusBadgeTone(creditNote.status)}>
                      {formatInvoiceStatusLabel(creditNote.status)}
                    </s-badge>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Payment status</s-text>
                    {paymentLabel ? (
                      <s-badge
                        tone={paymentStatusBadgeTone(creditNote.financialStatus)}
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
                      {formatMoney(creditNote.grandTotal, creditNote.currency)}
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
