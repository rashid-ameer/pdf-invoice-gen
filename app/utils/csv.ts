export const CSV_EXPORT_LIMIT = 5000;

export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function csvFilename(prefix: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${prefix}-${day}.csv`;
}

export function normalizeFinancialStatus(value?: string | null): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function formatPaymentStatus(status?: string | null): string {
  const key = normalizeFinancialStatus(status);
  if (!key) return "";
  const labels: Record<string, string> = {
    pending: "Pending",
    authorized: "Authorized",
    partially_paid: "Partially paid",
    paid: "Paid",
    partially_refunded: "Partially refunded",
    refunded: "Refunded",
    voided: "Voided",
    expired: "Expired",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}
