import type { Prisma } from "@prisma/client";

import { APP_LOCALE, DEFAULT_CURRENCY } from "../constants/app";
import prisma from "../db.server";
import {
  CSV_EXPORT_LIMIT,
  formatPaymentStatus,
  toCsv,
} from "../utils/csv";
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
  page: number;
  limit: number;
  tab: CreditNoteListTab;
}

export function parseCreditNoteListTab(raw: unknown): CreditNoteListTab {
  if (raw === "refund-documents" || raw === "refund") return "refund-documents";
  return "credit-notes";
}

export function parseCreditNoteListQuery(
  raw: Record<string, unknown>,
): CreditNoteListQuery {
  return {
    page: parseDocumentPage(raw.page),
    limit: parseDocumentPageSize(raw.limit),
    tab: parseCreditNoteListTab(raw.tab),
  };
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
  query: CreditNoteListQuery = parseCreditNoteListQuery({}),
) {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const where: Prisma.CreditNoteWhereInput = { storeId: store.id };
  const requestedSkip = Math.max(0, (query.page - 1) * query.limit);

  const [total, firstPage] = await Promise.all([
    prisma.creditNote.count({ where }),
    prisma.creditNote.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: requestedSkip,
      take: query.limit,
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / query.limit) || 1);
  const page = Math.min(query.page, pages);
  let notes = firstPage;
  if (page !== query.page && total > 0) {
    notes = await prisma.creditNote.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * query.limit,
      take: query.limit,
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
    limit: query.limit,
    query: { ...query, page },
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
