import { useCallback, useEffect, useState } from "react";
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
  DOCUMENT_PAGE_SIZE_OPTIONS,
  listCreditNotesForShop,
  parseCreditNoteListQuery,
  type CreditNoteListTab,
} from "../models/credit-note-list.server";
import { enqueueSyncRefunds } from "../models/sync-queue.server";
import { formatPaymentStatus } from "../utils/csv";
import {
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import { authenticate } from "../shopify.server";

/**
 * Group 11 Phase 3 — Credit Notes list (tabs for credit note / refund document).
 * Same CreditNote rows for both tabs. Sync + CSV only; no document actions yet.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = parseCreditNoteListQuery(
    Object.fromEntries(url.searchParams.entries()),
  );

  const list = await listCreditNotesForShop(session.shop, query);
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
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

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

/** Old credit-notes list date: toLocaleDateString(APP_LOCALE). */
function formatListDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE);
}

export default function CreditNotesPage() {
  const data = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const loading = navigation.state === "loading";
  const syncBusy = syncFetcher.state !== "idle";
  const [csvBusy, setCsvBusy] = useState(false);

  const tab: CreditNoteListTab = data.query.tab;
  const isCreditTab = tab === "credit-notes";

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    shopify.toast.show(syncFetcher.data.message, {
      isError: !syncFetcher.data.ok,
    });
  }, [syncFetcher.state, syncFetcher.data, shopify]);

  const updateQuery = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      navigate(qs ? `/app/credit-notes?${qs}` : "/app/credit-notes");
    },
    [navigate, searchParams],
  );

  const switchTab = (nextTab: CreditNoteListTab) => {
    updateQuery({
      tab: nextTab === "credit-notes" ? null : nextTab,
      page: null,
    });
  };

  const startSyncRefunds = () => {
    const form = new FormData();
    form.set("intent", "sync");
    syncFetcher.submit(form, { method: "post" });
  };

  /** CSV download without React Router navigation or table loading. */
  const downloadCsvExport = async () => {
    if (csvBusy) return;
    setCsvBusy(true);
    try {
      const kind = isCreditTab ? "credit-notes" : "refund-documents";
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
        (isCreditTab ? "credit-notes.csv" : "refund-documents.csv");
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

  const showEmptyContent = !loading && data.items.length === 0;
  const showTableRows = data.items.length > 0;
  const showPagination = showTableRows;

  const tabSwitcher = (
    <s-button-group gap="none" accessibilityLabel="Document type">
      <s-button
        slot="secondary-actions"
        {...(isCreditTab
          ? { icon: "check", accessibilityLabel: "Credit notes, selected" }
          : { accessibilityLabel: "Credit notes" })}
        onClick={() => switchTab("credit-notes")}
        aria-pressed={isCreditTab}
      >
        Credit notes
      </s-button>
      <s-button
        slot="secondary-actions"
        {...(!isCreditTab
          ? {
              icon: "check",
              accessibilityLabel: "Refund documents, selected",
            }
          : { accessibilityLabel: "Refund documents" })}
        onClick={() => switchTab("refund-documents")}
        aria-pressed={!isCreditTab}
      >
        Refund documents
      </s-button>
    </s-button-group>
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

      {showEmptyContent ? (
        <s-section accessibilityLabel="No credit notes yet">
          <s-box padding="small" background="subdued">
            {tabSwitcher}
          </s-box>
          <s-empty-state
            heading={
              isCreditTab ? "No credit notes yet" : "No refund documents yet"
            }
          >
            <s-icon
              slot="graphic"
              type="order"
              size="base"
              color="subdued"
            />
            <s-text slot="subheading">
              {isCreditTab
                ? "Credit notes are created when Shopify refunds are issued for orders that already have an invoice. Use Sync refunds to backfill."
                : "Refund documents use the same Shopify refund records as credit notes. Sync refunds to generate them."}
            </s-text>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Credit notes table">
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
            <s-box slot="filters" padding="small" background="subdued">
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                {tabSwitcher}

                <s-select
                  label="Per page"
                  labelAccessibilityVisibility="exclusive"
                  value={String(data.limit)}
                  onChange={(event: Event) => {
                    const value = (event.currentTarget as HTMLSelectElement)
                      .value;
                    updateQuery({ limit: value, page: null });
                  }}
                >
                  {DOCUMENT_PAGE_SIZE_OPTIONS.map((size) => (
                    <s-option key={size} value={String(size)}>
                      {size} per page
                    </s-option>
                  ))}
                </s-select>
              </s-stack>
            </s-box>

            <s-table-header-row>
              <s-table-header listSlot="primary">
                {isCreditTab ? "Credit note" : "Reference"}
              </s-table-header>
              {isCreditTab ? (
                <s-table-header listSlot="labeled">Invoice</s-table-header>
              ) : null}
              <s-table-header listSlot="labeled">Order</s-table-header>
              <s-table-header listSlot="labeled">Customer</s-table-header>
              <s-table-header listSlot="labeled">Date</s-table-header>
              <s-table-header listSlot="labeled">Reason</s-table-header>
              {isCreditTab ? (
                <s-table-header listSlot="labeled">Status</s-table-header>
              ) : null}
              <s-table-header listSlot="labeled">Payment</s-table-header>
              <s-table-header listSlot="labeled" format="currency">
                Total
              </s-table-header>
            </s-table-header-row>

            <s-table-body>
              {showTableRows
                ? data.items.map((note) => {
                    const paymentLabel = formatPaymentStatus(
                      note.financialStatus,
                    );
                    return (
                      <s-table-row key={note.id}>
                        <s-table-cell>
                          <s-text type="strong">{note.creditNoteNumber}</s-text>
                        </s-table-cell>
                        {isCreditTab ? (
                          <s-table-cell>
                            {note.originalInvoiceNumber}
                          </s-table-cell>
                        ) : null}
                        <s-table-cell>{note.shopifyOrderNumber}</s-table-cell>
                        <s-table-cell>
                          <s-stack direction="block" gap="none">
                            <s-text>{note.buyerName}</s-text>
                            {note.buyerEmail ? (
                              <s-text color="subdued">{note.buyerEmail}</s-text>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          {formatListDate(note.issueDate)}
                        </s-table-cell>
                        <s-table-cell>{note.reason || "—"}</s-table-cell>
                        {isCreditTab ? (
                          <s-table-cell>
                            <s-badge tone={invoiceStatusBadgeTone(note.status)}>
                              {formatInvoiceStatusLabel(note.status)}
                            </s-badge>
                          </s-table-cell>
                        ) : null}
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
                            "—"
                          )}
                        </s-table-cell>
                        <s-table-cell>
                          {formatMoney(note.grandTotal, note.currency)}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })
                : null}
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
