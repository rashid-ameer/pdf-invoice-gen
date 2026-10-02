/** UI-visible filters only (search, invoice status, date range). */
export function hasActiveInvoiceUiFilters(query: {
  q: string;
  status: string;
  from: string;
  to: string;
}): boolean {
  return Boolean(
    query.q ||
      (query.status && query.status !== "all") ||
      query.from ||
      query.to,
  );
}
