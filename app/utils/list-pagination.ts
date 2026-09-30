export const DOCUMENT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DOCUMENT_PAGE_SIZE = 10;

export function parseDocumentPage(raw: unknown): number {
  const pageRaw = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
}

export function parseDocumentPageSize(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return DOCUMENT_PAGE_SIZE_OPTIONS.includes(
    n as (typeof DOCUMENT_PAGE_SIZE_OPTIONS)[number],
  )
    ? n
    : DOCUMENT_PAGE_SIZE;
}
