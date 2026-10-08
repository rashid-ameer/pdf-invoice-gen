/** Client-safe Home dashboard types and filter parsers. */

import type { DocumentType } from "../types/index";

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

/** Client-safe slice of initial setup for the Home onboarding UI. */
export type HomeInitialSetup = {
  locked: boolean;
  companyComplete: boolean;
  templatesComplete: boolean;
  stagesComplete: boolean;
  nextTemplateType: DocumentType | null;
};

export type HomeLoaderData = {
  initialSetup: HomeInitialSetup | null;
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

export type HomeFinishSetupActionData = {
  intent: "finish-setup";
  ok: boolean;
  error: string | null;
};

export type HomeActionData = HomeChartActionData | HomeFinishSetupActionData;

export function parseHomeDateRange(value: string | null | undefined): HomeDateRange {
  return value === "7" ? "7" : "30";
}

export function parseHomeCompare(value: string | null | undefined): HomeCompare {
  return value === "none" ? "none" : "previous";
}
