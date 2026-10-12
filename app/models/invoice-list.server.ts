import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { APP_LOCALE, DEFAULT_CURRENCY } from "../constants/app";
import {
  CSV_EXPORT_LIMIT,
  formatPaymentStatus,
  normalizeFinancialStatus,
  toCsv,
} from "../utils/csv";
import {
  DOCUMENT_PAGE_SIZE,
  parseDocumentPage,
  parseDocumentPageSize,
} from "../utils/list-pagination";
import { dubaiDayBounds } from "../utils/date-bounds";
import { hydrateInvoiceFinancialStatus } from "./shopify-order-financial.server";

export {
  DOCUMENT_PAGE_SIZE as INVOICE_PAGE_SIZE,
  DOCUMENT_PAGE_SIZE_OPTIONS as INVOICE_PAGE_SIZE_OPTIONS,
} from "../utils/list-pagination";

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  shopifyOrderNumber: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  issueDate: string;
  status: string;
  financialStatus: string;
  mode: string;
  currency: string;
  grandTotal: number;
  subtotal: number;
  discount: number;
  vatTotal: number;
  shipping: number;
  shippingMethod: string;
}

export const INVOICE_STATUS_GROUPS: Record<string, string[]> = {
  pending: ["draft", "generated", "ready", "pending"],
  issued: ["downloaded", "delivered", "submitted", "accepted"],
  attention: ["failed", "rejected"],
};

const INVOICE_STATUSES = new Set([
  "draft",
  "generated",
  "ready",
  "downloaded",
  "submitted",
  "accepted",
  "rejected",
  "pending",
  "delivered",
  "failed",
]);

/** Common Shopify financial_status values used for filters. */
export const PAYMENT_STATUS_FILTER_OPTIONS = [
  "pending",
  "authorized",
  "partially_paid",
  "paid",
  "partially_refunded",
  "refunded",
  "voided",
  "expired",
] as const;

export interface InvoiceListQuery {
  q: string;
  status: string;
  /** Maps to Invoice.financialStatus (product decision: filter included in G9). */
  paymentStatus: string;
  from: string;
  to: string;
  page: number;
  limit: number;
}

export function parseInvoiceListQuery(
  raw: Record<string, unknown>,
): InvoiceListQuery {
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  const paymentRaw =
    typeof raw.paymentStatus === "string"
      ? raw.paymentStatus
      : typeof raw.financialStatus === "string"
        ? raw.financialStatus
        : "";
  const paymentStatus = normalizeFinancialStatus(paymentRaw);
  const from = isDay(raw.from) ? String(raw.from) : "";
  const to = isDay(raw.to) ? String(raw.to) : "";
  return {
    q,
    status,
    paymentStatus,
    from,
    to,
    page: parseDocumentPage(raw.page),
    limit: parseDocumentPageSize(raw.limit),
  };
}

export function invoiceListHasFilters(query: InvoiceListQuery): boolean {
  return Boolean(
    query.q || query.status || query.paymentStatus || query.from || query.to,
  );
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function statusFilter(
  status: string,
): string | { in: string[] } | undefined {
  if (!status || status === "all") return undefined;
  const groupKey = status.startsWith("group:") ? status.slice(6) : "";
  if (groupKey && INVOICE_STATUS_GROUPS[groupKey]) {
    return { in: INVOICE_STATUS_GROUPS[groupKey] };
  }
  if (INVOICE_STATUSES.has(status)) return status;
  return undefined;
}

/** Escape % and _ for LIKE / ILIKE. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Buyer is JSON/JSONB. Prisma cannot reliably case-insensitive-search nested
 * JSON paths, so we use Postgres `->>` + ILIKE.
 * Returns matching invoice ids for the store, or null when search is empty.
 */
async function findInvoiceIdsMatchingSearch(
  storeId: string,
  q: string,
): Promise<string[] | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const pattern = `%${escapeLike(trimmed)}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Invoice"
    WHERE "storeId" = ${storeId}
      AND (
        "invoiceNumber" ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE("shopifyOrderNumber", '') ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE("buyer"->>'name', '') ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE("buyer"->>'email', '') ILIKE ${pattern} ESCAPE '\\'
      )
  `;
  return rows.map((row) => row.id);
}

type TotalsJson = {
  grandTotal?: number;
  subtotal?: number;
  discount?: number;
  vatTotal?: number;
  shipping?: number;
};

type BuyerJson = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function mapInvoiceListItem(
  invoice: {
    id: string;
    invoiceNumber: string;
    shopifyOrderNumber?: string | null;
    buyer: unknown;
    issueDate: Date;
    status: string;
    financialStatus?: string | null;
    mode: string;
    currency: string;
    totals: unknown;
    shippingMethod?: string | null;
  },
  storeCurrency?: string,
): InvoiceListItem {
  const buyer = (invoice.buyer ?? {}) as BuyerJson;
  const totals = (invoice.totals ?? {}) as TotalsJson;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    shopifyOrderNumber: invoice.shopifyOrderNumber ?? "-",
    buyerName: buyer.name ?? "Customer",
    buyerEmail: buyer.email ?? "",
    buyerPhone: buyer.phone ?? "",
    issueDate: invoice.issueDate.toISOString(),
    status: invoice.status,
    financialStatus: invoice.financialStatus ?? "",
    mode: invoice.mode,
    currency: invoice.currency || storeCurrency || DEFAULT_CURRENCY,
    grandTotal: totals.grandTotal ?? 0,
    subtotal: totals.subtotal ?? 0,
    discount: totals.discount ?? 0,
    vatTotal: totals.vatTotal ?? 0,
    shipping: totals.shipping ?? 0,
    shippingMethod: invoice.shippingMethod ?? "",
  };
}

const LIST_SELECT = {
  id: true,
  invoiceNumber: true,
  shopifyOrderNumber: true,
  buyer: true,
  issueDate: true,
  status: true,
  financialStatus: true,
  mode: true,
  currency: true,
  totals: true,
  shippingMethod: true,
} satisfies Prisma.InvoiceSelect;

export async function listInvoicesForShop(
  shopDomain: string,
  query: InvoiceListQuery = parseInvoiceListQuery({}),
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const where: Prisma.InvoiceWhereInput = { storeId: store.id };

  const status = statusFilter(query.status);
  if (status) where.status = status;

  if (query.paymentStatus) {
    where.financialStatus = query.paymentStatus;
  }

  const issueDate = dubaiDayBounds(query.from, query.to);
  if (issueDate) {
    where.issueDate = {};
    if (issueDate.gte) where.issueDate.gte = issueDate.gte;
    if (issueDate.lte) where.issueDate.lte = issueDate.lte;
  }

  const searchIds = await findInvoiceIdsMatchingSearch(store.id, query.q);
  if (searchIds) {
    if (searchIds.length === 0) {
      return {
        store,
        items: [] as InvoiceListItem[],
        total: 0,
        page: 1,
        pages: 1,
        limit: query.limit,
        query: { ...query, page: 1 },
        hasFilters: invoiceListHasFilters(query),
      };
    }
    where.id = { in: searchIds };
  }

  const requestedSkip = Math.max(0, (query.page - 1) * query.limit);
  const [total, firstPage] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: requestedSkip,
      take: query.limit,
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / query.limit) || 1);
  const page = Math.min(query.page, pages);
  let invoices = firstPage;
  if (page !== query.page && total > 0) {
    invoices = await prisma.invoice.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * query.limit,
      take: query.limit,
    });
  }

  return {
    store,
    items: invoices.map((invoice) =>
      mapInvoiceListItem(invoice, store.currency),
    ),
    total,
    page,
    pages,
    limit: query.limit,
    query: { ...query, page },
    hasFilters: invoiceListHasFilters(query),
  };
}

/**
 * CSV export: ALL invoices for the shop (ignores UI filters), capped at CSV_EXPORT_LIMIT.
 * Hydrates missing financialStatus from Shopify when possible (old parity).
 *
 * `limit` is for tests only — production always uses CSV_EXPORT_LIMIT (5,000).
 */
export async function exportAllInvoicesForShop(
  shopDomain: string,
  options?: { limit?: number },
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const take =
    typeof options?.limit === "number" && options.limit > 0
      ? Math.min(options.limit, CSV_EXPORT_LIMIT)
      : CSV_EXPORT_LIMIT;

  const invoices = await prisma.invoice.findMany({
    where: { storeId: store.id },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      ...LIST_SELECT,
      shopifyOrderId: true,
    },
  });

  const hydrated = await hydrateInvoiceFinancialStatus(shopDomain, invoices);

  return {
    items: hydrated.map((invoice) =>
      mapInvoiceListItem(invoice, store.currency),
    ),
    truncated: invoices.length === take,
    limit: take,
  };
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE);
}

/**
 * CSV for invoices or packing slips (same rows; different columns).
 * Packing-slip columns match the old app `kind=packing-slips` export.
 */
export function invoicesToCsv(
  items: InvoiceListItem[],
  kind: "invoices" | "packing-slips" = "invoices",
): string {
  if (kind === "packing-slips") {
    return toCsv(
      [
        "Order",
        "Invoice",
        "Customer",
        "Email",
        "Phone",
        "Date",
        "Payment status",
        "Shipping method",
        "Currency",
        "Grand total",
      ],
      items.map((row) => [
        row.shopifyOrderNumber,
        row.invoiceNumber,
        row.buyerName,
        row.buyerEmail,
        row.buyerPhone,
        formatDay(row.issueDate),
        formatPaymentStatus(row.financialStatus),
        row.shippingMethod,
        row.currency,
        row.grandTotal,
      ]),
    );
  }

  return toCsv(
    [
      "Invoice",
      "Order",
      "Customer",
      "Email",
      "Phone",
      "Date",
      "Document status",
      "Payment status",
      "Currency",
      "Subtotal",
      "Discount",
      "VAT",
      "Shipping",
      "Grand total",
      "Mode",
    ],
    items.map((row) => [
      row.invoiceNumber,
      row.shopifyOrderNumber,
      row.buyerName,
      row.buyerEmail,
      row.buyerPhone,
      formatDay(row.issueDate),
      row.status,
      formatPaymentStatus(row.financialStatus),
      row.currency,
      row.subtotal,
      row.discount,
      row.vatTotal,
      row.shipping,
      row.grandTotal,
      row.mode,
    ]),
  );
}

export { CSV_EXPORT_LIMIT, DOCUMENT_PAGE_SIZE };
