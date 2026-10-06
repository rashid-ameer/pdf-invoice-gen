/**
 * Helpers for the Invoices index date-range filter (UI only).
 * Maps s-date-picker range values ↔ existing `from` / `to` YYYY-MM-DD query params.
 */

import { APP_LOCALE } from "../constants/app";

function isDay(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Local calendar today as YYYY-MM-DD (for date-picker allow bound). */
export function invoiceDatePickerTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `allow` value: any date through today inclusive (blocks future dates). */
export function invoiceDatePickerAllowThroughToday(): string {
  return `--${invoiceDatePickerTodayIso()}`;
}

/** Build s-date-picker `value` from existing from/to query params. */
export function invoiceDateRangePickerValue(from: string, to: string): string {
  if (from && to) return `${from}--${to}`;
  if (from) return `${from}--${from}`;
  if (to) return `${to}--${to}`;
  return "";
}

/** Parse s-date-picker range value into from/to query params. */
export function parseInvoiceDateRangePickerValue(value: string): {
  from: string | null;
  to: string | null;
} {
  const trimmed = value.trim();
  if (!trimmed) return { from: null, to: null };
  const [fromRaw, toRaw] = trimmed.split("--");
  if (!isDay(fromRaw)) return { from: null, to: null };
  if (!isDay(toRaw)) return { from: null, to: null };
  return { from: fromRaw, to: toRaw };
}

function formatDayLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDayMonthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Readable chip / popover label, e.g. "Oct 1 – Oct 6, 2026".
 * Returns null when neither bound is set.
 */
export function formatInvoiceDateRangeLabel(
  from: string,
  to: string,
): string | null {
  if (!from && !to) return null;
  if (from && to) {
    if (from === to) return formatDayLong(from);
    const fromYear = from.slice(0, 4);
    const toYear = to.slice(0, 4);
    if (fromYear === toYear) {
      return `${formatDayMonthDay(from)} – ${formatDayLong(to)}`;
    }
    return `${formatDayLong(from)} – ${formatDayLong(to)}`;
  }
  return formatDayLong(from || to);
}
