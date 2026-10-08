/** Client-safe Home dashboard types and filter parsers. */

export type HomeDateRange = "7" | "30";
export type HomeCompare = "previous" | "none";

export type HomeTotals = {
  invoices: number;
  creditNotes: number;
  emailsSent: number;
  hasAnyInvoices: boolean;
};

export type HomeChartPoint = {
  /** 1-based day index within the selected range (aligns current vs previous). */
  day: number;
  /** Short x-axis label for the current period day, e.g. "Sep 9". */
  label: string;
  current: number;
  /** Present when comparing; always a number (0 on quiet days). */
  previous: number | null;
  currentDate: string;
  previousDate: string | null;
};

export type HomeChartSeries = {
  range: HomeDateRange;
  compare: HomeCompare;
  /** Exactly 7 or 30 points. */
  points: HomeChartPoint[];
  /** True when every current-period point is 0. */
  emptyCurrentPeriod: boolean;
};

export type HomeLoaderData = {
  totals: HomeTotals | null;
  totalsError: string | null;
  chart: HomeChartSeries | null;
  chartError: string | null;
};

export type HomeChartActionData = {
  intent: "chart";
  chart: HomeChartSeries | null;
  chartError: string | null;
  range: HomeDateRange;
  compare: HomeCompare;
};

export function parseHomeDateRange(value: string | null | undefined): HomeDateRange {
  return value === "7" ? "7" : "30";
}

export function parseHomeCompare(value: string | null | undefined): HomeCompare {
  return value === "none" ? "none" : "previous";
}
