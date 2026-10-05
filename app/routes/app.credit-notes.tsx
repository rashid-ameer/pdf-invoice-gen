import { useCallback, useEffect, useMemo, useState } from "react";
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
  listCreditNotesForShop,
  parseCreditNoteListQuery,
  type CreditNoteListItem,
} from "../models/credit-note-list.server";
import { enqueueSyncRefunds } from "../models/sync-queue.server";
import { formatPaymentStatus } from "../utils/csv";
import { downloadCreditNotePdf } from "../utils/download-credit-note-pdf";
import {
  formatInvoiceStatusLabel,
  invoiceStatusBadgeTone,
  paymentStatusBadgeTone,
} from "../utils/invoice-status-badges";
import {
  fetchAndPrintCreditNoteDocument,
  fetchAndPrintCreditNoteDocuments,
} from "../utils/print-invoice-document";
import { authenticate } from "../shopify.server";

/**
 * Credit Notes index — Polaris table sibling of Invoices.
 * Docs: https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table
 *       https://shopify.dev/docs/apps/design/layout#using-tables
 *
 * Keep this constant client-safe (do not import from *.server modules into
 * the route component — React Router blocks that and the page fails to load).
 */
const BULK_PRINT_LIMIT = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = parseCreditNoteListQuery(
    Object.fromEntries(url.searchParams.entries()),
  );
  // Credit notes index always lists credit-note rows (refund documents are separate).
  query.tab = "credit-notes";

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
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const loading = navigation.state === "loading";
  const syncBusy = syncFetcher.state !== "idle";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printSelectedBusy, setPrintSelectedBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    shopify.toast.show(syncFetcher.data.message, {
      isError: !syncFetcher.data.ok,
    });
  }, [syncFetcher.state, syncFetcher.data, shopify]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [data.page, data.limit]);

  const updateQuery = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in patch)) next.delete("page");
      // Always stay on credit-notes list.
      next.delete("tab");
      const qs = next.toString();
      navigate(qs ? `/app/credit-notes?${qs}` : "/app/credit-notes");
    },
    [navigate, searchParams],
  );

  const startSyncRefunds = () => {
    const form = new FormData();
    form.set("intent", "sync");
    syncFetcher.submit(form, { method: "post" });
  };

  const downloadCsvExport = async () => {
    if (csvBusy) return;
    setCsvBusy(true);
    try {
      const response = await fetch(
        "/app/credit-notes/export/csv?kind=credit-notes",
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
      const filename = filenameMatch?.[1] || "credit-notes.csv";
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

  const showEmptyContent = !loading && data.items.length === 0;
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
    navigate(`/app/credit-notes/${encodeURIComponent(id)}`);
  };

  const copyCreditNoteNumber = async (creditNoteNumber: string) => {
    try {
      await navigator.clipboard.writeText(creditNoteNumber);
      shopify.toast.show(`Copied ${creditNoteNumber}`);
    } catch {
      shopify.toast.show("Could not copy credit note number", {
        isError: true,
      });
    }
  };

  const openPrint = (id: string) => {
    void fetchAndPrintCreditNoteDocument(id);
  };

  const openDownload = async (id: string, creditNoteNumber: string) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      await downloadCreditNotePdf({
        creditNoteId: id,
        creditNoteNumber,
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
    if (ids.length > BULK_PRINT_LIMIT) {
      shopify.toast.show("You can print up to 50 credit notes at once", {
        isError: true,
      });
      return;
    }
    setPrintSelectedBusy(true);
    void fetchAndPrintCreditNoteDocuments(ids).finally(() => {
      setPrintSelectedBusy(false);
    });
  };

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
          <s-empty-state heading="No credit notes yet">
            <s-icon slot="graphic" type="order" size="base" color="subdued" />
            <s-text slot="subheading">
              Credit notes appear here when Shopify refunds are issued for
              orders that already have an invoice. Use Sync refunds if you
              already have refunds in the store.
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
            ) : null}

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
                      accessibilityLabel="Select all credit notes on this page"
                      onChange={(event: Event) => {
                        togglePage(
                          (event.currentTarget as HTMLInputElement).checked,
                        );
                      }}
                    />
                    <s-text>Credit note</s-text>
                  </s-grid>
                ) : (
                  <s-text>Credit note</s-text>
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
              {showTableRows
                ? data.items.map((note: CreditNoteListItem) => {
                    const checkboxId = `credit-note-select-${note.id}`;
                    const linkId = `credit-note-link-${note.id}`;
                    const menuId = `credit-note-actions-${note.id}`;
                    const detailsHref = `/app/credit-notes/${encodeURIComponent(note.id)}`;
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
                          {note.originalInvoiceNumber}
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
                              icon="clipboard"
                              onClick={() =>
                                void copyCreditNoteNumber(note.creditNoteNumber)
                              }
                            >
                              Copy
                            </s-button>
                            <s-button
                              icon="print"
                              onClick={() => openPrint(note.id)}
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
                          </s-menu>
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
