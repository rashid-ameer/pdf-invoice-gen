import type { Prisma } from "@prisma/client";

import { APP_LOCALE, DEFAULT_CURRENCY } from "../constants/app";
import prisma from "../db.server";
import {
  CSV_EXPORT_LIMIT,
  formatPaymentStatus,
  toCsv,
} from "../utils/csv";
import { dubaiDayBounds } from "../utils/date-bounds";
import {
  DOCUMENT_PAGE_SIZE,
  DOCUMENT_PAGE_SIZE_OPTIONS,
  parseDocumentPage,
  parseDocumentPageSize,
} from "../utils/list-pagination";

export type CreditNoteListTab = "credit-notes" | "refund-documents";

export interface CreditNoteListItem {
  id: string;
  creditNoteNumber: string;
  originalInvoiceNumber: string;
  originalInvoiceId: string;
  shopifyOrderNumber: string;
  buyerName: string;
  buyerEmail: string;
  issueDate: string;
  status: string;
  financialStatus: string;
  currency: string;
  grandTotal: number;
  subtotal: number;
  discount: number;
  vatTotal: number;
  reason: string;
}

export interface CreditNoteListQuery {
  q: string;
  status: string;
  from: string;
  to: string;
  page: number;
  limit: number;
  tab: CreditNoteListTab;
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseCreditNoteListTab(raw: unknown): CreditNoteListTab {
  if (raw === "refund-documents" || raw === "refund") return "refund-documents";
  return "credit-notes";
}

export function parseCreditNoteListQuery(
  raw: Record<string, unknown>,
): CreditNoteListQuery {
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  const from = isDay(raw.from) ? String(raw.from) : "";
  const to = isDay(raw.to) ? String(raw.to) : "";
  return {
    q,
    status,
    from,
    to,
    page: parseDocumentPage(raw.page),
    limit: parseDocumentPageSize(raw.limit),
    tab: parseCreditNoteListTab(raw.tab),
  };
}

export function creditNoteListHasFilters(query: CreditNoteListQuery): boolean {
  return Boolean(
    query.q ||
      (query.status && query.status !== "all") ||
      query.from ||
      query.to,
  );
}

/** Escape % and _ for LIKE / ILIKE. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Search by document number, linked invoice/order, or buyer (Postgres ILIKE).
 * Returns matching ids, or null when search is empty.
 */
async function findCreditNoteIdsMatchingSearch(
  storeId: string,
  q: string | undefined,
): Promise<string[] | null> {
  const trimmed = typeof q === "string" ? q.trim() : "";
  if (!trimmed) return null;

  const pattern = `%${escapeLike(trimmed)}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT cn.id AS id FROM "CreditNote" cn
    LEFT JOIN "Invoice" inv ON inv.id = cn."invoiceId"
    WHERE cn."storeId" = ${storeId}
      AND (
        cn."creditNoteNumber" ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(cn."buyer"->>'name', '') ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(cn."buyer"->>'email', '') ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(inv."invoiceNumber", '') ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(inv."shopifyOrderNumber", '') ILIKE ${pattern} ESCAPE '\\'
      )
  `;
  return rows.map((row) => row.id);
}

type InvoiceLookup = Record<
  string,
  {
    invoiceNumber: string;
    shopifyOrderNumber: string;
    financialStatus: string;
  }
>;

async function invoiceLookupForNotes(
  notes: Array<{ invoiceId: string }>,
): Promise<InvoiceLookup> {
  const invoiceIds = [
    ...new Set(notes.map((note) => note.invoiceId).filter(Boolean)),
  ];
  if (invoiceIds.length === 0) return {};

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: {
      id: true,
      invoiceNumber: true,
      shopifyOrderNumber: true,
      financialStatus: true,
    },
  });

  return Object.fromEntries(
    invoices.map((invoice) => [
      invoice.id,
      {
        invoiceNumber: invoice.invoiceNumber,
        shopifyOrderNumber: invoice.shopifyOrderNumber ?? "-",
        financialStatus: invoice.financialStatus ?? "",
      },
    ]),
  );
}

function parseBuyer(value: unknown): { name: string; email: string } {
  const buyer = (value ?? {}) as { name?: string; email?: string };
  return {
    name: buyer.name?.trim() || "Customer",
    email: buyer.email?.trim() || "",
  };
}

function parseTotals(value: unknown): {
  grandTotal: number;
  subtotal: number;
  discount: number;
  vatTotal: number;
} {
  const totals = (value ?? {}) as Record<string, unknown>;
  return {
    grandTotal: Number(totals.grandTotal) || 0,
    subtotal: Number(totals.subtotal) || 0,
    discount: Number(totals.discount) || 0,
    vatTotal: Number(totals.vatTotal) || 0,
  };
}

function mapCreditNoteListItem(
  note: {
    id: string;
    invoiceId: string;
    creditNoteNumber: string;
    issueDate: Date;
    status: string;
    currency: string;
    reason: string | null;
    buyer: unknown;
    totals: unknown;
  },
  invoiceMap: InvoiceLookup,
  storeCurrency: string,
): CreditNoteListItem {
  const inv = invoiceMap[note.invoiceId];
  const buyer = parseBuyer(note.buyer);
  const totals = parseTotals(note.totals);
  return {
    id: note.id,
    creditNoteNumber: note.creditNoteNumber,
    originalInvoiceNumber: inv?.invoiceNumber ?? "-",
    originalInvoiceId: note.invoiceId,
    shopifyOrderNumber: inv?.shopifyOrderNumber ?? "-",
    buyerName: buyer.name,
    buyerEmail: buyer.email,
    issueDate: note.issueDate?.toISOString() ?? new Date().toISOString(),
    status: note.status,
    financialStatus: inv?.financialStatus ?? "",
    currency: note.currency || storeCurrency || DEFAULT_CURRENCY,
    grandTotal: totals.grandTotal,
    subtotal: totals.subtotal,
    discount: totals.discount,
    vatTotal: totals.vatTotal,
    reason: note.reason ?? "",
  };
}

const LIST_SELECT = {
  id: true,
  invoiceId: true,
  creditNoteNumber: true,
  issueDate: true,
  status: true,
  currency: true,
  reason: true,
  buyer: true,
  totals: true,
  createdAt: true,
} satisfies Prisma.CreditNoteSelect;

/** Old listCreditNotesForShop: createdAt desc, page/limit, store scoped. */
export async function listCreditNotesForShop(
  shopDomain: string,
  query: Partial<CreditNoteListQuery> = {},
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const defaults = parseCreditNoteListQuery({});
  const normalized: CreditNoteListQuery = {
    q: typeof query.q === "string" ? query.q : defaults.q,
    status: typeof query.status === "string" ? query.status : defaults.status,
    from: typeof query.from === "string" ? query.from : defaults.from,
    to: typeof query.to === "string" ? query.to : defaults.to,
    page:
      typeof query.page === "number" && query.page > 0
        ? Math.floor(query.page)
        : defaults.page,
    // Preserve explicit numeric limits from callers/tests (may be outside UI page-size options).
    limit:
      typeof query.limit === "number" && query.limit > 0
        ? Math.floor(query.limit)
        : defaults.limit,
    tab: query.tab ?? defaults.tab,
  };

  const where: Prisma.CreditNoteWhereInput = { storeId: store.id };

  if (normalized.status && normalized.status !== "all") {
    where.status = normalized.status;
  }

  const issueDate = dubaiDayBounds(normalized.from, normalized.to);
  if (issueDate) {
    where.issueDate = {};
    if (issueDate.gte) where.issueDate.gte = issueDate.gte;
    if (issueDate.lte) where.issueDate.lte = issueDate.lte;
  }

  const searchIds = await findCreditNoteIdsMatchingSearch(
    store.id,
    normalized.q,
  );
  if (searchIds) {
    if (searchIds.length === 0) {
      return {
        store,
        items: [] as CreditNoteListItem[],
        total: 0,
        page: 1,
        pages: 1,
        limit: normalized.limit,
        query: { ...normalized, page: 1 },
        hasFilters: creditNoteListHasFilters(normalized),
      };
    }
    where.id = { in: searchIds };
  }

  const requestedSkip = Math.max(0, (normalized.page - 1) * normalized.limit);

  const [total, firstPage] = await Promise.all([
    prisma.creditNote.count({ where }),
    prisma.creditNote.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: requestedSkip,
      take: normalized.limit,
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / normalized.limit) || 1);
  const page = Math.min(normalized.page, pages);
  let notes = firstPage;
  if (page !== normalized.page && total > 0) {
    notes = await prisma.creditNote.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * normalized.limit,
      take: normalized.limit,
    });
  }

  const invoiceMap = await invoiceLookupForNotes(notes);

  return {
    store,
    items: notes.map((note) =>
      mapCreditNoteListItem(note, invoiceMap, store.currency),
    ),
    total,
    page,
    pages,
    limit: normalized.limit,
    query: { ...normalized, page },
    hasFilters: creditNoteListHasFilters(normalized),
  };
}

/**
 * Old exportCreditNotesForShop: ALL store credit notes, createdAt desc, cap CSV_EXPORT_LIMIT.
 * Same rows for both CSV kinds; column header differs for the number column.
 */
export async function exportCreditNotesForShop(
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

  const notes = await prisma.creditNote.findMany({
    where: { storeId: store.id },
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take,
  });

  const invoiceMap = await invoiceLookupForNotes(notes);
  const items = notes.map((note) =>
    mapCreditNoteListItem(note, invoiceMap, store.currency),
  );

  return { items, truncated: notes.length === CSV_EXPORT_LIMIT };
}

/** Old formatNoteDay for CSV date column. */
function formatNoteDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(APP_LOCALE);
}

/**
 * Old creditNotesToCsv — same data for both kinds; first header differs.
 */
export function creditNotesToCsv(
  items: CreditNoteListItem[],
  kind: "credit-notes" | "refund-documents",
): string {
  const numberHeader = kind === "refund-documents" ? "Reference" : "Credit note";
  return toCsv(
    [
      numberHeader,
      "Original invoice",
      "Order",
      "Customer",
      "Email",
      "Date",
      "Reason",
      "Document status",
      "Order payment status",
      "Currency",
      "Subtotal",
      "Discount",
      "VAT",
      "Grand total",
    ],
    items.map((row) => [
      row.creditNoteNumber,
      row.originalInvoiceNumber,
      row.shopifyOrderNumber,
      row.buyerName,
      row.buyerEmail,
      formatNoteDay(row.issueDate),
      row.reason,
      row.status,
      formatPaymentStatus(row.financialStatus),
      row.currency,
      row.subtotal,
      row.discount,
      row.vatTotal,
      row.grandTotal,
    ]),
  );
}

export {
  CSV_EXPORT_LIMIT,
  DOCUMENT_PAGE_SIZE,
  DOCUMENT_PAGE_SIZE_OPTIONS,
};
