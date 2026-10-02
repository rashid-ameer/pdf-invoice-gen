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
  listInvoicesForShop,
  parseInvoiceListQuery,
  type InvoiceListItem,
} from "../models/invoice-list.server";
import { enqueueSyncOrders } from "../models/sync-queue.server";
import { reregisterWebhooksForShop } from "../models/webhook-register.server";
import { formatPaymentStatus } from "../utils/csv";
import {
  INVOICE_DOCUMENT_STATUSES,
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import { hasActiveInvoiceUiFilters } from "../utils/invoice-ui-filters";
import { downloadInvoicePdf } from "../utils/download-invoice-pdf";
import {
  fetchAndPrintInvoiceDocument,
  fetchAndPrintInvoiceDocuments,
} from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/** Filters: stacked (small) → 2 cols (medium) → single row (large).
 * Larger breakpoints must come last so they win when multiple queries match.
 */
const FILTER_GRID_COLS =
  '@container (inline-size > 600px) "1fr 1fr", (inline-size > 900px) "1fr 1fr 1fr 1fr", 1fr';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = parseInvoiceListQuery(
    Object.fromEntries(url.searchParams.entries()),
  );

  const list = await listInvoicesForShop(session.shop, query);
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
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "sync") {
    try {
      await enqueueSyncOrders(session.shop);
      return {
        ok: true as const,
        intent: "sync" as const,
        message:
          "Sync started in background — refresh in a moment to see new invoices",
      };
    } catch (error) {
      console.error("[invoices] sync action error:", error);
      return {
        ok: false as const,
        intent: "sync" as const,
        message: "Failed to start order sync. Try again.",
      };
    }
  }

  if (intent === "reregister") {
    const result = await reregisterWebhooksForShop(session.shop);
    return {
      ok: result.ok,
      intent: "reregister" as const,
      message: result.ok
        ? result.message
        : (result.message ?? result.error),
      needsReauth: result.needsReauth,
    };
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

function formatIssueDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function InvoicesPage() {
  const data = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const webhookFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const loading = navigation.state === "loading";
  const syncBusy = syncFetcher.state !== "idle";
  const webhookBusy = webhookFetcher.state !== "idle";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(data.query.q);
  const [printSelectedBusy, setPrintSelectedBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchDraft(data.query.q);
  }, [data.query.q]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    data.page,
    data.query.q,
    data.query.status,
    data.query.from,
    data.query.to,
  ]);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    shopify.toast.show(syncFetcher.data.message, {
      isError: !syncFetcher.data.ok,
    });
  }, [syncFetcher.state, syncFetcher.data, shopify]);

  useEffect(() => {
    if (webhookFetcher.state !== "idle" || !webhookFetcher.data) return;
    shopify.toast.show(webhookFetcher.data.message, {
      isError: !webhookFetcher.data.ok,
    });
  }, [webhookFetcher.state, webhookFetcher.data, shopify]);

  const updateFilters = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "" || value === "all") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      navigate(qs ? `/app/invoices?${qs}` : "/app/invoices");
    },
    [navigate, searchParams],
  );

  const clearSearchAndFilters = () => {
    setSearchDraft("");
    if (searchTimer.current) clearTimeout(searchTimer.current);
    navigate("/app/invoices");
  };

  const scheduleSearch = (value: string) => {
    setSearchDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateFilters({ q: value.trim() || null });
    }, 250);
  };

  const startSyncOrders = () => {
    const form = new FormData();
    form.set("intent", "sync");
    syncFetcher.submit(form, { method: "post" });
  };

  const startReregisterWebhooks = () => {
    const form = new FormData();
    form.set("intent", "reregister");
    webhookFetcher.submit(form, { method: "post" });
  };

  /** Download CSV without React Router navigation (avoids table loading / leaving the page). */
  const downloadCsvExport = async () => {
    try {
      const response = await fetch("/app/invoices/export/csv");
      if (!response.ok) {
        shopify.toast.show("Failed to export CSV. Try again.", {
          isError: true,
        });
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] || "invoices.csv";
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

  const copyInvoiceNumber = async (invoiceNumber: string) => {
    try {
      await navigator.clipboard.writeText(invoiceNumber);
      shopify.toast.show(`Copied ${invoiceNumber}`);
    } catch {
      shopify.toast.show("Could not copy invoice number", { isError: true });
    }
  };

  const openView = (id: string) => {
    navigate(`/app/invoices/${encodeURIComponent(id)}`);
  };

  const openPrint = (id: string) => {
    void fetchAndPrintInvoiceDocument(id);
  };

  /**
   * Direct PDF download via existing /download route (G5/G7).
   * Plain fetch — no React Router navigation, no new tab, no table loading.
   */
  const openDownload = async (id: string, invoiceNumber: string) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      await downloadInvoicePdf({
        invoiceId: id,
        invoiceNumber,
        onError: (message) => {
          shopify.toast.show(message, { isError: true });
        },
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const printSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || printSelectedBusy) return;
    setPrintSelectedBusy(true);
    void fetchAndPrintInvoiceDocuments(ids).finally(() => {
      setPrintSelectedBusy(false);
    });
  };

  return (
    <s-page heading="Invoices" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={startSyncOrders}
        {...(syncBusy ? { loading: true, disabled: true } : {})}
      >
        Sync orders
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => {
          void downloadCsvExport();
        }}
      >
        Export CSV
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={startReregisterWebhooks}
        {...(webhookBusy ? { loading: true, disabled: true } : {})}
      >
        Re-register webhooks
      </s-button>

      {showFirstTimeEmpty ? (
        <s-section accessibilityLabel="No invoices yet">
          <s-empty-state heading="No invoices yet">
            <s-icon slot="graphic" type="order" size="base" color="subdued" />
            <s-text slot="subheading">
              Tax invoices appear here when Shopify orders sync. Use Sync
              orders if you already have orders in the store.
            </s-text>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={startSyncOrders}
              {...(syncBusy ? { loading: true } : {})}
            >
              Sync orders
            </s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Invoices table">
          <s-table
            {...(showPagination
              ? {
                  paginate: true,
                  hasPreviousPage: data.page > 1,
                  hasNextPage: data.page < data.pages,
                  onPreviousPage: () =>
                    updateFilters({
                      page: String(Math.max(1, data.page - 1)),
                    }),
                  onNextPage: () =>
                    updateFilters({ page: String(data.page + 1) }),
                }
              : {})}
            {...(loading ? { loading: true } : {})}
          >
            {hasSelection ? (
              <s-box slot="filters" padding="small" background="strong">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text type="strong">{selectedIds.size} selected</s-text>
                  <s-button
                    onClick={printSelected}
                    {...(printSelectedBusy
                      ? { loading: true, disabled: true }
                      : {})}
                  >
                    Print selected
                  </s-button>
                </s-stack>
              </s-box>
            ) : (
              <s-query-container slot="filters">
                <s-grid
                  gap="small"
                  alignItems="end"
                  gridTemplateColumns={FILTER_GRID_COLS}
                >
                  <s-text-field
                    label="Search"
                    labelAccessibilityVisibility="exclusive"
                    icon="search"
                    placeholder="Invoice, order, customer, email"
                    value={searchDraft}
                    autocomplete="off"
                    onInput={(event: Event) => {
                      const value = (event.currentTarget as HTMLInputElement)
                        .value;
                      scheduleSearch(value);
                    }}
                  />
                  <s-select
                    label="Invoice status"
                    value={data.query.status || "all"}
                    onChange={(event: Event) => {
                      const value = (event.currentTarget as HTMLSelectElement)
                        .value;
                      updateFilters({
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
                  <s-date-field
                    label="From"
                    value={data.query.from}
                    onChange={(event: Event) => {
                      const value = (event.currentTarget as HTMLInputElement)
                        .value;
                      updateFilters({ from: value || null });
                    }}
                  />
                  <s-date-field
                    label="To"
                    value={data.query.to}
                    onChange={(event: Event) => {
                      const value = (event.currentTarget as HTMLInputElement)
                        .value;
                      updateFilters({ to: value || null });
                    }}
                  />
                </s-grid>
              </s-query-container>
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
                      accessibilityLabel="Select all invoices on this page"
                      onChange={(event: Event) => {
                        togglePage(
                          (event.currentTarget as HTMLInputElement).checked,
                        );
                      }}
                    />
                    <s-text>Invoice</s-text>
                  </s-grid>
                ) : (
                  <s-text>Invoice</s-text>
                )}
              </s-table-header>
              <s-table-header listSlot="labeled">Order</s-table-header>
              <s-table-header listSlot="labeled">Customer</s-table-header>
              <s-table-header listSlot="labeled">Date</s-table-header>
              <s-table-header listSlot="labeled" format="currency">
                Total
              </s-table-header>
              <s-table-header listSlot="labeled">Payment status</s-table-header>
              <s-table-header listSlot="labeled">Invoice status</s-table-header>
              <s-table-header listSlot="labeled">Actions</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {showFilteredEmpty ? (
                <s-empty-state heading="No invoices found">
                  <s-icon
                    slot="graphic"
                    type="search"
                    size="base"
                    color="subdued"
                  />
                  <s-text slot="subheading">
                    Try changing the filters or search terms for this view
                  </s-text>
                  <s-button
                    slot="primary-action"
                    variant="primary"
                    onClick={clearSearchAndFilters}
                  >
                    Clear search and filters
                  </s-button>
                </s-empty-state>
              ) : showTableRows ? (
                data.items.map((invoice: InvoiceListItem) => {
                  const checkboxId = `invoice-select-${invoice.id}`;
                  const linkId = `invoice-link-${invoice.id}`;
                  const menuId = `invoice-actions-${invoice.id}`;
                  const detailsHref = `/app/invoices/${encodeURIComponent(invoice.id)}`;
                  const paymentLabel = formatPaymentStatus(
                    invoice.financialStatus,
                  );
                  return (
                    <s-table-row key={invoice.id} clickDelegate={linkId}>
                      <s-table-cell>
                        <s-grid
                          gridTemplateColumns="auto 1fr"
                          gap="small"
                          alignItems="center"
                        >
                          <s-checkbox
                            id={checkboxId}
                            checked={selectedIds.has(invoice.id)}
                            accessibilityLabel={`Select ${invoice.invoiceNumber}`}
                            onChange={(event: Event) => {
                              toggleRow(
                                invoice.id,
                                (event.currentTarget as HTMLInputElement)
                                  .checked,
                              );
                            }}
                          />
                          <s-link id={linkId} href={detailsHref}>
                            {invoice.invoiceNumber}
                          </s-link>
                        </s-grid>
                      </s-table-cell>
                      <s-table-cell>{invoice.shopifyOrderNumber}</s-table-cell>
                      <s-table-cell>{invoice.buyerName}</s-table-cell>
                      <s-table-cell>
                        {formatIssueDate(invoice.issueDate)}
                      </s-table-cell>
                      <s-table-cell>
                        {formatMoney(invoice.grandTotal, invoice.currency)}
                      </s-table-cell>
                      <s-table-cell>
                        {paymentLabel ? (
                          <s-badge
                            tone={paymentStatusBadgeTone(
                              invoice.financialStatus,
                            )}
                          >
                            {paymentLabel}
                          </s-badge>
                        ) : (
                          <s-text>—</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={invoiceStatusBadgeTone(invoice.status)}>
                          {formatInvoiceStatusLabel(invoice.status)}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button
                          icon="menu-horizontal"
                          variant="tertiary"
                          accessibilityLabel={`More actions for ${invoice.invoiceNumber}`}
                          commandFor={menuId}
                        />
                        <s-menu
                          id={menuId}
                          accessibilityLabel={`Actions for ${invoice.invoiceNumber}`}
                        >
                          <s-button
                            icon="view"
                            onClick={() => openView(invoice.id)}
                          >
                            View
                          </s-button>
                          <s-button
                            icon="clipboard"
                            onClick={() =>
                              void copyInvoiceNumber(invoice.invoiceNumber)
                            }
                          >
                            Copy
                          </s-button>
                          <s-button
                            icon="print"
                            onClick={() => openPrint(invoice.id)}
                          >
                            Print
                          </s-button>
                          <s-button
                            icon="download"
                            onClick={() =>
                              void openDownload(
                                invoice.id,
                                invoice.invoiceNumber,
                              )
                            }
                            {...(downloadingId === invoice.id
                              ? { loading: true, disabled: true }
                              : downloadingId
                                ? { disabled: true }
                                : {})}
                          >
                            Download
                          </s-button>
                          <s-button icon="email" disabled>
                            Send email
                          </s-button>
                        </s-menu>
                      </s-table-cell>
                    </s-table-row>
                  );
                })
              ) : null}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
