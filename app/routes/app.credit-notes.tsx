import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { APP_LOCALE } from "../constants/app";
import {
  sendCreditNoteEmail,
  sendRefundDocumentEmail,
} from "../models/document-email.server";
import {
  listCreditNotesForShop,
  parseCreditNoteListQuery,
  type CreditNoteListItem,
  type CreditNoteListTab,
} from "../models/credit-note-list.server";
import { listRefundDocumentTemplatesForShop } from "../models/credit-note-document.server";
import { issueCreditNotePublicLinkForShop } from "../models/public-link.server";
import { enqueueSyncRefunds } from "../models/sync-queue.server";
import {
  CUSTOMER_LINK_MODAL_ID,
  CustomerLinkCopyModal,
} from "../components/customer-link-copy-modal";
import { DocumentPrintPreviewModal } from "../components/document-print-preview-modal";
import { formatPaymentStatus } from "../utils/csv";
import { downloadCreditNotePdf } from "../utils/download-credit-note-pdf";
import { downloadRefundDocumentPdf } from "../utils/download-refund-document-pdf";
import {
  INVOICE_DOCUMENT_STATUSES,
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import { hasActiveInvoiceUiFilters } from "../utils/invoice-ui-filters";
import {
  formatInvoiceDateRangeLabel,
  invoiceDatePickerAllowThroughToday,
  invoiceDatePickerTodayIso,
  invoiceDateRangePickerValue,
  parseInvoiceDateRangePickerValue,
} from "../utils/invoice-date-range";
import {
  fetchCreditNoteDocumentsHtml,
  fetchRefundDocumentsHtml,
} from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

const CREDIT_NOTE_PRINT_PREVIEW_MODAL_ID = "credit-note-print-preview-modal";

/**
 * Credit Notes index — Polaris table sibling of Invoices.
 * Tabs use App Home segmented button-group (no s-tabs in App Home):
 * https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/tabs
 *
 * Keep this constant client-safe (do not import from *.server modules into
 * the route component — React Router blocks that and the page fails to load).
 */
const BULK_PRINT_LIMIT = 50;

const CREDIT_NOTES_FILTERS_POPOVER_ID = "credit-notes-filters-popover";
const CREDIT_NOTES_FILTERS_TOOLTIP_ID = "credit-notes-filters-tooltip";

/** List route only — not credit-note / refund details. */
function isCreditNotesListPath(pathname: string): boolean {
  return /^\/app\/credit-notes\/?$/.test(pathname);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = parseCreditNoteListQuery(
    Object.fromEntries(url.searchParams.entries()),
  );

  const [list, refundTemplatesResult] = await Promise.all([
    listCreditNotesForShop(session.shop, query),
    listRefundDocumentTemplatesForShop(session.shop),
  ]);
  if (!list) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  return {
    items: list.items,
    total: list.total,
    page: list.page,
    pages: list.pages,
    limit: list.limit,
    query: list.query,
    hasFilters: list.hasFilters,
    refundTemplates: refundTemplatesResult ?? [],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "send-email") {
    const creditNoteId = String(formData.get("documentId") ?? "").trim();
    const documentType =
      String(formData.get("documentType") ?? "") === "refund_document"
        ? ("refund_document" as const)
        : ("credit_note" as const);

    if (!creditNoteId) {
      return {
        ok: false as const,
        intent: "send-email" as const,
        error: "Credit note not found",
      };
    }

    // Direct send: buyer email + default PDF template from Phase 1 service.
    const result =
      documentType === "refund_document"
        ? await sendRefundDocumentEmail({
            shop: session.shop,
            creditNoteId,
            trigger: "manual",
          })
        : await sendCreditNoteEmail({
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
    const creditNoteId = String(formData.get("documentId") ?? "").trim();
    const documentType =
      String(formData.get("documentType") ?? "") === "refund_document"
        ? ("refund_document" as const)
        : ("credit_note" as const);

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
      documentType,
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

  if (intent === "sync") {
    try {
      await enqueueSyncRefunds(session.shop);
      return {
        ok: true as const,
        intent: "sync" as const,
        message:
          "Refund sync started in background — refresh in a moment to see credit notes",
      };
    } catch (error) {
      console.error("[credit-notes] sync action error:", error);
      return {
        ok: false as const,
        intent: "sync" as const,
        message: "Failed to start refund sync. Try again.",
      };
    }
  }

  return {
    ok: false as const,
    intent: "unknown" as const,
    message: "Unknown action",
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

/** Same as Invoices: "Oct 2, 2019". */
function formatIssueDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CreditNotesPage() {
  const data = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const emailFetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  // Table spinner only for list query changes — not when leaving to details.
  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isCreditNotesListPath(navigation.location.pathname);
  const syncBusy = syncFetcher.state !== "idle";
  const emailSending =
    emailFetcher.state === "submitting" || emailFetcher.state === "loading";
  const linkCopying =
    linkFetcher.state === "submitting" || linkFetcher.state === "loading";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(data.query.q);
  const [dateRangeDraft, setDateRangeDraft] = useState(() =>
    invoiceDateRangePickerValue(data.query.from, data.query.to),
  );
  const [printSelectedBusy, setPrintSelectedBusy] = useState(false);
  const [printModalHeading, setPrintModalHeading] = useState("Print credit note");
  const [printPreviewHtml, setPrintPreviewHtml] = useState<string | null>(null);
  const [printPreviewLoading, setPrintPreviewLoading] = useState(false);
  const [printPreviewError, setPrintPreviewError] = useState<string | null>(
    null,
  );
  const printFetchGeneration = useRef(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
  const [linkDocumentId, setLinkDocumentId] = useState<string | null>(null);
  const [customerLinkModalUrl, setCustomerLinkModalUrl] = useState("");
  const [customerLinkError, setCustomerLinkError] = useState<string | null>(
    null,
  );
  const [csvBusy, setCsvBusy] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailAwaiting = useRef(false);
  const emailDataAtSubmit = useRef(emailFetcher.data);
  const linkAwaiting = useRef(false);
  const linkDataAtSubmit = useRef(linkFetcher.data);

  useEffect(() => {
    setSearchDraft(data.query.q);
  }, [data.query.q]);

  useEffect(() => {
    setDateRangeDraft(
      invoiceDateRangePickerValue(data.query.from, data.query.to),
    );
  }, [data.query.from, data.query.to]);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    if (syncFetcher.data.intent !== "sync") return;
    shopify.toast.show(syncFetcher.data.message, {
      isError: !syncFetcher.data.ok,
    });
  }, [syncFetcher.state, syncFetcher.data, shopify]);

  useEffect(() => {
    if (!emailAwaiting.current || emailFetcher.state !== "idle") return;
    emailAwaiting.current = false;
    setEmailSendingId(null);

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

    if (!linkFetcher.data.ok || !("url" in linkFetcher.data) || !linkFetcher.data.url) {
      setCustomerLinkError(
        ("error" in linkFetcher.data && linkFetcher.data.error) ||
          "Failed to create link",
      );
      return;
    }

    setCustomerLinkError(null);
    setCustomerLinkModalUrl(linkFetcher.data.url);
  }, [linkFetcher.state, linkFetcher.data]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    data.page,
    data.limit,
    data.query.tab,
    data.query.q,
    data.query.status,
    data.query.from,
    data.query.to,
  ]);

  const activeTab: CreditNoteListTab = data.query.tab;
  const isRefundTab = activeTab === "refund-documents";
  const defaultRefundTemplateId =
    data.refundTemplates.find((t) => t.isDefault)?.id ??
    data.refundTemplates[0]?.id ??
    undefined;

  const updateQuery = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "" || value === "all") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      navigate(qs ? `/app/credit-notes?${qs}` : "/app/credit-notes");
    },
    [navigate, searchParams],
  );

  const switchTab = (tab: CreditNoteListTab) => {
    if (tab === activeTab) return;
    updateQuery({
      tab: tab === "credit-notes" ? null : "refund-documents",
      page: null,
    });
  };

  const clearPopoverFilters = () => {
    setDateRangeDraft("");
    updateQuery({ status: null, from: null, to: null });
  };

  const scheduleSearch = (value: string) => {
    setSearchDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateQuery({ q: value.trim() || null });
    }, 250);
  };

  const onDateRangeChange = (event: Event) => {
    const value = String(
      (event.currentTarget as HTMLInputElement & { value: string }).value ?? "",
    );
    setDateRangeDraft(value);
    if (!value) {
      updateQuery({ from: null, to: null });
      return;
    }
    const parsed = parseInvoiceDateRangePickerValue(value);
    if (parsed.from && parsed.to) {
      updateQuery({ from: parsed.from, to: parsed.to });
    }
  };

  const startSyncRefunds = () => {
    const form = new FormData();
    form.set("intent", "sync");
    syncFetcher.submit(form, { method: "post" });
  };

  const downloadCsvExport = async () => {
    if (csvBusy) return;
    setCsvBusy(true);
    try {
      const kind = isRefundTab ? "refund-documents" : "credit-notes";
      const response = await fetch(
        `/app/credit-notes/export/csv?kind=${encodeURIComponent(kind)}`,
      );
      if (!response.ok) {
        shopify.toast.show("Failed to export CSV. Try again.", {
          isError: true,
        });
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename =
        filenameMatch?.[1] ||
        (isRefundTab ? "refund-documents.csv" : "credit-notes.csv");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      shopify.toast.show("Failed to export CSV. Try again.", { isError: true });
    } finally {
      setCsvBusy(false);
    }
  };

  const visibleIds = useMemo(
    () => data.items.map((item) => item.id),
    [data.items],
  );
  const allOnPageSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someOnPageSelected =
    visibleIds.some((id) => selectedIds.has(id)) && !allOnPageSelected;
  const hasSelection = selectedIds.size > 0 && data.items.length > 0;

  const hasActiveFilters = hasActiveInvoiceUiFilters(data.query);
  const statusFilterActive =
    Boolean(data.query.status) && data.query.status !== "all";
  const dateRangeLabel = formatInvoiceDateRangeLabel(
    data.query.from,
    data.query.to,
  );
  const hasAppliedPopoverFilters = statusFilterActive || Boolean(dateRangeLabel);
  const datePickerAllow = invoiceDatePickerAllowThroughToday();
  const datePickerView = (data.query.from || invoiceDatePickerTodayIso()).slice(
    0,
    7,
  );
  const showEmptyContent = !loading && data.items.length === 0;
  const showFilteredEmpty = showEmptyContent && hasActiveFilters;
  const showFirstTimeEmpty = showEmptyContent && !hasActiveFilters;
  const showTableRows = data.items.length > 0;
  const showPagination = showTableRows;

  const togglePage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const openView = (id: string) => {
    if (isRefundTab) {
      navigate(`/app/credit-notes/${encodeURIComponent(id)}/refund`);
      return;
    }
    navigate(`/app/credit-notes/${encodeURIComponent(id)}`);
  };

  const resetPrintPreviewModal = () => {
    printFetchGeneration.current += 1;
    setPrintPreviewHtml(null);
    setPrintPreviewLoading(false);
    setPrintPreviewError(null);
    setPrintSelectedBusy(false);
  };

  const openPrintPreview = (ids: string[], heading: string) => {
    const uniqueIds = [
      ...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
    ];
    if (uniqueIds.length === 0) return;

    const generation = printFetchGeneration.current + 1;
    printFetchGeneration.current = generation;
    setPrintModalHeading(heading);
    setPrintPreviewHtml(null);
    setPrintPreviewError(null);
    setPrintPreviewLoading(true);
    setPrintSelectedBusy(true);
    void shopify.modal.show(CREDIT_NOTE_PRINT_PREVIEW_MODAL_ID);

    const fetchHtml = isRefundTab
      ? () => fetchRefundDocumentsHtml(uniqueIds, defaultRefundTemplateId)
      : () => fetchCreditNoteDocumentsHtml(uniqueIds);

    void fetchHtml().then((result) => {
      if (printFetchGeneration.current !== generation) return;
      setPrintPreviewLoading(false);
      setPrintSelectedBusy(false);
      if (!result.ok) {
        setPrintPreviewError(result.error);
        return;
      }
      setPrintPreviewHtml(result.html);
    });
  };

  const openPrint = (id: string, creditNoteNumber: string) => {
    openPrintPreview(
      [id],
      isRefundTab
        ? `Print refund ${creditNoteNumber}`
        : `Print ${creditNoteNumber}`,
    );
  };

  const openDownload = async (id: string, creditNoteNumber: string) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      if (isRefundTab) {
        await downloadRefundDocumentPdf({
          creditNoteId: id,
          creditNoteNumber,
          templateId: defaultRefundTemplateId,
          onError: (message) => {
            shopify.toast.show(message, { isError: true });
          },
        });
      } else {
        await downloadCreditNotePdf({
          creditNoteId: id,
          creditNoteNumber,
          onError: (message) => {
            shopify.toast.show(message, { isError: true });
          },
        });
      }
    } finally {
      setDownloadingId(null);
    }
  };

  /** Direct send with buyer email + default PDF template (no modal). */
  const sendEmail = (note: CreditNoteListItem) => {
    if (emailSending) return;
    setEmailSendingId(note.id);
    emailDataAtSubmit.current = emailFetcher.data;
    emailAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "send-email");
    body.set("documentId", note.id);
    body.set(
      "documentType",
      isRefundTab ? "refund_document" : "credit_note",
    );
    emailFetcher.submit(body, { method: "post" });
  };

  const openCustomerLinkModal = (noteId: string) => {
    setLinkDocumentId(noteId);
    setCustomerLinkModalUrl("");
    setCustomerLinkError(null);
    void shopify.modal.show(CUSTOMER_LINK_MODAL_ID);
  };

  const generateCustomerLink = () => {
    if (!linkDocumentId || linkCopying) return;
    setCustomerLinkError(null);
    setCustomerLinkModalUrl("");
    linkDataAtSubmit.current = linkFetcher.data;
    linkAwaiting.current = true;
    const body = new FormData();
    body.set("intent", "customer-link");
    body.set("documentId", linkDocumentId);
    body.set(
      "documentType",
      isRefundTab ? "refund_document" : "credit_note",
    );
    linkFetcher.submit(body, { method: "post" });
  };

  const resetCustomerLinkModal = () => {
    setLinkDocumentId(null);
    setCustomerLinkModalUrl("");
    setCustomerLinkError(null);
  };

  const printSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || printSelectedBusy) return;
    if (ids.length > BULK_PRINT_LIMIT) {
      shopify.toast.show("You can print up to 50 documents at once", {
        isError: true,
      });
      return;
    }
    const heading = isRefundTab
      ? ids.length === 1
        ? "Print refund document"
        : `Print ${ids.length} refund documents`
      : ids.length === 1
        ? "Print credit note"
        : `Print ${ids.length} credit notes`;
    openPrintPreview(ids, heading);
  };

  const documentTypeSwitcher = (
    <s-box paddingBlock="base">
      <s-grid
        gridTemplateColumns="auto auto"
        gap="small-200"
        alignItems="center"
        justifyContent="start"
        accessibilityLabel="Document type"
      >
        <s-clickable
          paddingBlock="small-200"
          paddingInline="base"
          border="none"
          borderRadius="base"
          background={activeTab === "credit-notes" ? "strong" : "transparent"}
          accessibilityLabel="Show credit notes"
          onClick={() => switchTab("credit-notes")}
        >
          <s-text type="strong" fontWeight="semibold">
            Credit notes
          </s-text>
        </s-clickable>
        <s-clickable
          paddingBlock="small-200"
          paddingInline="base"
          border="none"
          borderRadius="base"
          background={isRefundTab ? "strong" : "transparent"}
          accessibilityLabel="Show document refunds"
          onClick={() => switchTab("refund-documents")}
        >
          <s-text type="strong" fontWeight="semibold">
            Document refunds
          </s-text>
        </s-clickable>
      </s-grid>
    </s-box>
  );

  return (
    <s-page heading="Credit notes" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={startSyncRefunds}
        {...(syncBusy ? { loading: true, disabled: true } : {})}
      >
        Sync refunds
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => {
          void downloadCsvExport();
        }}
        {...(csvBusy ? { loading: true, disabled: true } : {})}
      >
        Export CSV
      </s-button>

      <s-section padding="none" accessibilityLabel="Credit notes">
        {showFirstTimeEmpty ? (
          <s-box padding="base">
            <s-stack gap="base">
              {documentTypeSwitcher}
              <s-empty-state
                heading={
                  isRefundTab
                    ? "No document refunds yet"
                    : "No credit notes yet"
                }
              >
                <s-icon
                  slot="graphic"
                  type="order"
                  size="base"
                  color="subdued"
                />
                <s-text slot="subheading">
                  {isRefundTab
                    ? "Document refunds use the same Shopify refund records as credit notes. Sync refunds to generate them."
                    : "Credit notes appear here when Shopify refunds are issued for orders that already have an invoice. Use Sync refunds if you already have refunds in the store."}
                </s-text>
              </s-empty-state>
            </s-stack>
          </s-box>
        ) : (
          <s-table
            {...(showPagination
              ? {
                  paginate: true,
                  hasPreviousPage: data.page > 1,
                  hasNextPage: data.page < data.pages,
                  onPreviousPage: () =>
                    updateQuery({
                      page: String(Math.max(1, data.page - 1)),
                    }),
                  onNextPage: () =>
                    updateQuery({ page: String(data.page + 1) }),
                }
              : {})}
            {...(loading ? { loading: true } : {})}
          >
            {hasSelection ? (
              <s-stack slot="filters" gap="small-200">
                {documentTypeSwitcher}
                <s-box padding="small" background="strong">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text type="strong">{selectedIds.size} selected</s-text>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        onClick={printSelected}
                        {...(printSelectedBusy
                          ? { loading: true, disabled: true }
                          : {})}
                      >
                        Print selected
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-stack>
            ) : (
              <s-stack slot="filters" gap="small-200">
                {documentTypeSwitcher}
                <s-grid
                  gap="small-200"
                  gridTemplateColumns="1fr auto"
                  alignItems="center"
                >
                  <s-text-field
                    label="Search"
                    labelAccessibilityVisibility="exclusive"
                    icon="search"
                    placeholder="Search by document, invoice, order, customer, email"
                    value={searchDraft}
                    autocomplete="off"
                    onInput={(event: Event) => {
                      const value = (event.currentTarget as HTMLInputElement)
                        .value;
                      scheduleSearch(value);
                    }}
                  />
                  <s-button
                    icon={
                      hasAppliedPopoverFilters ? "filter-active" : "filter"
                    }
                    variant="secondary"
                    accessibilityLabel="Filters"
                    interestFor={CREDIT_NOTES_FILTERS_TOOLTIP_ID}
                    commandFor={CREDIT_NOTES_FILTERS_POPOVER_ID}
                  />
                </s-grid>
                <s-tooltip id={CREDIT_NOTES_FILTERS_TOOLTIP_ID}>
                  <s-text>Filters</s-text>
                </s-tooltip>
                <s-popover
                  id={CREDIT_NOTES_FILTERS_POPOVER_ID}
                  inlineSize="320px"
                >
                  <s-box padding="base">
                    <s-stack gap="base">
                      <s-select
                        label="Document status"
                        value={data.query.status || "all"}
                        onChange={(event: Event) => {
                          const value = (
                            event.currentTarget as HTMLSelectElement
                          ).value;
                          updateQuery({
                            status: value === "all" ? null : value,
                          });
                        }}
                      >
                        <s-option value="all">All statuses</s-option>
                        {INVOICE_DOCUMENT_STATUSES.map((status) => (
                          <s-option key={status} value={status}>
                            {formatInvoiceStatusLabel(status)}
                          </s-option>
                        ))}
                      </s-select>
                      <s-divider />
                      <s-stack gap="small-200">
                        <s-text type="strong">Date range</s-text>
                        <s-date-picker
                          type="range"
                          name="credit-note-date-range"
                          value={dateRangeDraft}
                          view={datePickerView}
                          allow={datePickerAllow}
                          onChange={onDateRangeChange}
                        />
                      </s-stack>
                    </s-stack>
                  </s-box>
                </s-popover>
                {hasAppliedPopoverFilters ? (
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    {statusFilterActive ? (
                      <s-clickable-chip
                        removable
                        accessibilityLabel={`Remove status filter ${formatInvoiceStatusLabel(data.query.status)}`}
                        onRemove={() => updateQuery({ status: null })}
                      >
                        Status: {formatInvoiceStatusLabel(data.query.status)}
                      </s-clickable-chip>
                    ) : null}
                    {dateRangeLabel ? (
                      <s-clickable-chip
                        removable
                        accessibilityLabel={`Remove date range filter ${dateRangeLabel}`}
                        onRemove={() => {
                          setDateRangeDraft("");
                          updateQuery({ from: null, to: null });
                        }}
                      >
                        {dateRangeLabel}
                      </s-clickable-chip>
                    ) : null}
                    <s-button variant="tertiary" onClick={clearPopoverFilters}>
                      Clear all
                    </s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            )}

            <s-table-header-row>
              <s-table-header listSlot="primary">
                {showTableRows ? (
                  <s-grid
                    gridTemplateColumns="auto 1fr"
                    gap="small"
                    alignItems="center"
                  >
                    <s-checkbox
                      checked={allOnPageSelected}
                      {...(someOnPageSelected ? { indeterminate: true } : {})}
                      accessibilityLabel="Select all documents on this page"
                      onChange={(event: Event) => {
                        togglePage(
                          (event.currentTarget as HTMLInputElement).checked,
                        );
                      }}
                    />
                    <s-text>Document</s-text>
                  </s-grid>
                ) : (
                  <s-text>Document</s-text>
                )}
              </s-table-header>
              <s-table-header listSlot="labeled">Invoice</s-table-header>
              <s-table-header listSlot="labeled">Order</s-table-header>
              <s-table-header listSlot="labeled">Customer</s-table-header>
              <s-table-header listSlot="labeled">Date</s-table-header>
              <s-table-header listSlot="labeled">Reason</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header listSlot="labeled">Payment</s-table-header>
              <s-table-header listSlot="labeled" format="currency">
                Total
              </s-table-header>
              <s-table-header listSlot="labeled">Actions</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {showFilteredEmpty ? (
                <s-empty-state
                  heading={
                    isRefundTab
                      ? "No document refunds found"
                      : "No credit notes found"
                  }
                >
                  <s-icon
                    slot="graphic"
                    type="search"
                    size="base"
                    color="subdued"
                  />
                  <s-text slot="subheading">
                    Try changing the filters or search terms for this view
                  </s-text>
                </s-empty-state>
              ) : showTableRows
                ? data.items.map((note: CreditNoteListItem) => {
                    const checkboxId = `credit-note-select-${note.id}`;
                    const linkId = `credit-note-link-${note.id}`;
                    const menuId = `credit-note-actions-${note.id}`;
                    const detailsHref = isRefundTab
                      ? `/app/credit-notes/${encodeURIComponent(note.id)}/refund`
                      : `/app/credit-notes/${encodeURIComponent(note.id)}`;
                    const paymentLabel = formatPaymentStatus(
                      note.financialStatus,
                    );
                    return (
                      <s-table-row key={note.id} clickDelegate={linkId}>
                        <s-table-cell>
                          <s-grid
                            gridTemplateColumns="auto 1fr"
                            gap="small"
                            alignItems="center"
                          >
                            <s-checkbox
                              id={checkboxId}
                              checked={selectedIds.has(note.id)}
                              accessibilityLabel={`Select ${note.creditNoteNumber}`}
                              onChange={(event: Event) => {
                                toggleRow(
                                  note.id,
                                  (event.currentTarget as HTMLInputElement)
                                    .checked,
                                );
                              }}
                            />
                            <s-link id={linkId} href={detailsHref}>
                              {note.creditNoteNumber}
                            </s-link>
                          </s-grid>
                        </s-table-cell>
                        <s-table-cell>
                          {note.originalInvoiceId ? (
                            <s-link
                              href={`/app/invoices/${encodeURIComponent(note.originalInvoiceId)}`}
                            >
                              {note.originalInvoiceNumber}
                            </s-link>
                          ) : (
                            note.originalInvoiceNumber
                          )}
                        </s-table-cell>
                        <s-table-cell>{note.shopifyOrderNumber}</s-table-cell>
                        <s-table-cell>{note.buyerName}</s-table-cell>
                        <s-table-cell>
                          {formatIssueDate(note.issueDate)}
                        </s-table-cell>
                        <s-table-cell>{note.reason || "—"}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={invoiceStatusBadgeTone(note.status)}>
                            {formatInvoiceStatusLabel(note.status)}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          {paymentLabel ? (
                            <s-badge
                              tone={paymentStatusBadgeTone(
                                note.financialStatus,
                              )}
                            >
                              {paymentLabel}
                            </s-badge>
                          ) : (
                            <s-text>—</s-text>
                          )}
                        </s-table-cell>
                        <s-table-cell>
                          {formatMoney(note.grandTotal, note.currency)}
                        </s-table-cell>
                        <s-table-cell>
                          <s-button
                            icon="menu-horizontal"
                            variant="tertiary"
                            accessibilityLabel={`More actions for ${note.creditNoteNumber}`}
                            commandFor={menuId}
                          />
                          <s-menu
                            id={menuId}
                            accessibilityLabel={`Actions for ${note.creditNoteNumber}`}
                          >
                            <s-button
                              icon="view"
                              onClick={() => openView(note.id)}
                            >
                              View
                            </s-button>
                            <s-button
                              icon="link"
                              onClick={() => openCustomerLinkModal(note.id)}
                            >
                              Generate customer link
                            </s-button>
                            <s-button
                              icon="print"
                              onClick={() =>
                                openPrint(note.id, note.creditNoteNumber)
                              }
                            >
                              Print
                            </s-button>
                            <s-button
                              icon="download"
                              onClick={() =>
                                void openDownload(
                                  note.id,
                                  note.creditNoteNumber,
                                )
                              }
                              {...(downloadingId === note.id
                                ? { loading: true, disabled: true }
                                : downloadingId
                                  ? { disabled: true }
                                  : {})}
                            >
                              Download
                            </s-button>
                            <s-button
                              icon="email"
                              onClick={() => sendEmail(note)}
                              {...(emailSendingId === note.id
                                ? { loading: true, disabled: true }
                                : emailSending
                                  ? { disabled: true }
                                  : {})}
                            >
                              Send email
                            </s-button>
                          </s-menu>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })
                : null}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <CustomerLinkCopyModal
        url={customerLinkModalUrl}
        generating={linkCopying}
        error={customerLinkError}
        onGenerate={generateCustomerLink}
        onHide={resetCustomerLinkModal}
      />

      <DocumentPrintPreviewModal
        id={CREDIT_NOTE_PRINT_PREVIEW_MODAL_ID}
        heading={printModalHeading}
        html={printPreviewHtml}
        loading={printPreviewLoading}
        error={printPreviewError}
        loadingLabel={
          isRefundTab
            ? "Loading refund document preview"
            : "Loading credit note preview"
        }
        onHide={resetPrintPreviewModal}
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
