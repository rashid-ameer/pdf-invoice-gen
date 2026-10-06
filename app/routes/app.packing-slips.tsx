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
import {
  formatInvoiceDateRangeLabel,
  invoiceDatePickerAllowThroughToday,
  invoiceDatePickerTodayIso,
  invoiceDateRangePickerValue,
  parseInvoiceDateRangePickerValue,
} from "../utils/invoice-date-range";
import { downloadPackingSlipPdf } from "../utils/download-packing-slip-pdf";
import {
  fetchAndPrintPackingSlipDocument,
  fetchAndPrintPackingSlipDocuments,
} from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/**
 * Group 10 — Packing Slips list page.
 * Sibling of Invoices: same invoice rows / list infrastructure.
 * Row View → Packing Slip Details; Print / Download / Print selected use
 * packing-slip G5/G7 routes (default packing_slip template; no bulk PDF).
 */

/** List route only — not packing-slip details. */
function isPackingSlipsListPath(pathname: string): boolean {
  return /^\/app\/packing-slips\/?$/.test(pathname);
}

const PACKING_SLIPS_FILTERS_POPOVER_ID = "packing-slips-filters-popover";
const PACKING_SLIPS_FILTERS_TOOLTIP_ID = "packing-slips-filters-tooltip";

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
          "Sync started in background — refresh in a moment to see new packing slips",
      };
    } catch (error) {
      console.error("[packing-slips] sync action error:", error);
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

export default function PackingSlipsPage() {
  const data = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const webhookFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  // Table spinner only for list query changes — not when leaving to details.
  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isPackingSlipsListPath(navigation.location.pathname);
  const syncBusy = syncFetcher.state !== "idle";
  const webhookBusy = webhookFetcher.state !== "idle";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(data.query.q);
  const [dateRangeDraft, setDateRangeDraft] = useState(() =>
    invoiceDateRangePickerValue(data.query.from, data.query.to),
  );
  const [printSelectedBusy, setPrintSelectedBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchDraft(data.query.q);
  }, [data.query.q]);

  useEffect(() => {
    setDateRangeDraft(
      invoiceDateRangePickerValue(data.query.from, data.query.to),
    );
  }, [data.query.from, data.query.to]);

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
      navigate(qs ? `/app/packing-slips?${qs}` : "/app/packing-slips");
    },
    [navigate, searchParams],
  );

  const clearPopoverFilters = () => {
    setDateRangeDraft("");
    updateFilters({ status: null, from: null, to: null });
  };

  const scheduleSearch = (value: string) => {
    setSearchDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateFilters({ q: value.trim() || null });
    }, 250);
  };

  const onDateRangeChange = (event: Event) => {
    const value = String(
      (event.currentTarget as HTMLInputElement & { value: string }).value ?? "",
    );
    setDateRangeDraft(value);
    if (!value) {
      updateFilters({ from: null, to: null });
      return;
    }
    const parsed = parseInvoiceDateRangePickerValue(value);
    if (parsed.from && parsed.to) {
      updateFilters({ from: parsed.from, to: parsed.to });
    }
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

  /** Download packing-slip CSV without React Router navigation. */
  const downloadCsvExport = async () => {
    try {
      const response = await fetch("/app/packing-slips/export/csv");
      if (!response.ok) {
        shopify.toast.show("Failed to export CSV. Try again.", {
          isError: true,
        });
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] || "packing-slips.csv";
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
    navigate(`/app/packing-slips/${encodeURIComponent(id)}`);
  };

  const openPrint = (id: string) => {
    void fetchAndPrintPackingSlipDocument(id);
  };

  /**
   * Direct packing-slip PDF download (G5/G7).
   * Plain fetch — no React Router navigation, no new tab, no table loading.
   */
  const openDownload = async (
    id: string,
    orderNumber: string,
    invoiceNumber: string,
  ) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      await downloadPackingSlipPdf({
        invoiceId: id,
        orderNumber,
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
    void fetchAndPrintPackingSlipDocuments(ids).finally(() => {
      setPrintSelectedBusy(false);
    });
  };

  return (
    <s-page heading="Packing slips" inlineSize="large">
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
        <s-section accessibilityLabel="No packing slips yet">
          <s-empty-state heading="No packing slips yet">
            <s-icon slot="graphic" type="order" size="base" color="subdued" />
            <s-text slot="subheading">
              Packing slips are created from your orders. Sync your orders to
              start generating packing slips.
            </s-text>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Packing slips table">
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
              <s-stack slot="filters" gap="small-200">
                <s-grid
                  gap="small-200"
                  gridTemplateColumns="1fr auto"
                  alignItems="center"
                >
                  <s-text-field
                    label="Search"
                    labelAccessibilityVisibility="exclusive"
                    icon="search"
                    placeholder="Search by invoice, order, customer, email"
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
                    interestFor={PACKING_SLIPS_FILTERS_TOOLTIP_ID}
                    commandFor={PACKING_SLIPS_FILTERS_POPOVER_ID}
                  />
                </s-grid>
                <s-tooltip id={PACKING_SLIPS_FILTERS_TOOLTIP_ID}>
                  <s-text>Filters</s-text>
                </s-tooltip>
                <s-popover
                  id={PACKING_SLIPS_FILTERS_POPOVER_ID}
                  inlineSize="320px"
                >
                  <s-box padding="base">
                    <s-stack gap="base">
                      <s-select
                        label="Invoice status"
                        value={data.query.status || "all"}
                        onChange={(event: Event) => {
                          const value = (
                            event.currentTarget as HTMLSelectElement
                          ).value;
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
                      <s-divider />
                      <s-stack gap="small-200">
                        <s-text type="strong">Date range</s-text>
                        <s-date-picker
                          type="range"
                          name="packing-slip-date-range"
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
                        onRemove={() => updateFilters({ status: null })}
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
                          updateFilters({ from: null, to: null });
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
                      accessibilityLabel="Select all packing slips on this page"
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
                <s-empty-state heading="No packing slips found">
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
              ) : showTableRows ? (
                data.items.map((invoice: InvoiceListItem) => {
                  const checkboxId = `packing-select-${invoice.id}`;
                  const linkId = `packing-link-${invoice.id}`;
                  const menuId = `packing-actions-${invoice.id}`;
                  const detailsHref = `/app/packing-slips/${encodeURIComponent(invoice.id)}`;
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
                                invoice.shopifyOrderNumber,
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
