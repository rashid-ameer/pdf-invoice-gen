/**
 * Home dashboard totals and invoice-per-day chart series.
 * Shop-scoped only. No schema changes.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  parseHomeCompare,
  parseHomeDateRange,
  type HomeActionData,
  type HomeChartActionData,
  type HomeChartPoint,
  type HomeChartSeries,
  type HomeCompare,
  type HomeDateRange,
  type HomeInitialSetup,
  type HomeLoaderData,
  type HomeTotals,
} from "./dashboard";
import {
  finishInitialSetup,
  getInitialSetupState,
} from "./initial-setup.server";
import { getActiveStoreForShop } from "./template.server";

export type {
  HomeActionData,
  HomeChartActionData,
  HomeChartPoint,
  HomeChartSeries,
  HomeCompare,
  HomeDateRange,
  HomeFinishSetupActionData,
  HomeInitialSetup,
  HomeLoaderData,
  HomeTotals,
} from "./dashboard";

function toHomeInitialSetup(
  state: NonNullable<Awaited<ReturnType<typeof getInitialSetupState>>>,
): HomeInitialSetup {
  return {
    locked: state.locked,
    companyComplete: state.companyComplete,
    templatesComplete: state.templatesComplete,
    stagesComplete: state.stagesComplete,
    nextTemplateType: state.nextTemplateType,
  };
}

const DEFAULT_RANGE: HomeDateRange = "30";
const DEFAULT_COMPARE: HomeCompare = "previous";

function dayKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shortLabelForDayKey(dayKey: string): string {
  const noon = new Date(`${dayKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(noon);
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Exactly `days` calendar keys ending at today in the shop timezone (inclusive). */
function trailingDayKeys(days: number, timeZone: string): string[] {
  const today = dayKeyInTimeZone(new Date(), timeZone);
  const keys: string[] = new Array(days);
  for (let i = 0; i < days; i += 1) {
    keys[i] = shiftDayKey(today, -(days - 1 - i));
  }
  return keys;
}

/** The `days` calendar keys immediately before the first current key. */
function previousDayKeys(currentKeys: string[]): string[] {
  const days = currentKeys.length;
  if (days === 0) return [];
  const first = currentKeys[0]!;
  const keys: string[] = new Array(days);
  for (let i = 0; i < days; i += 1) {
    keys[i] = shiftDayKey(first, -(days - i));
  }
  return keys;
}

async function countInvoicesByDay(
  storeId: string,
  dayKeys: string[],
  timeZone: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(dayKeys.map((key) => [key, 0]));
  if (dayKeys.length === 0) return counts;

  const first = dayKeys[0]!;
  const last = dayKeys[dayKeys.length - 1]!;
  const from = new Date(`${first}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${last}T23:59:59.999Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await prisma.invoice.findMany({
    where: {
      storeId,
      createdAt: { gte: from, lte: to },
    },
    select: { createdAt: true },
  });

  for (const row of rows) {
    const key = dayKeyInTimeZone(row.createdAt, timeZone);
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export async function getHomeTotals(shopDomain: string): Promise<HomeTotals | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const [invoices, creditNotes, emailsSent] = await Promise.all([
    prisma.invoice.count({ where: { storeId: store.id } }),
    prisma.creditNote.count({ where: { storeId: store.id } }),
    prisma.invoiceStatusEvent.count({
      where: {
        status: "email_sent",
        invoice: { storeId: store.id },
      },
    }),
  ]);

  return {
    invoices,
    creditNotes,
    emailsSent,
    hasAnyInvoices: invoices > 0,
  };
}

export async function getHomeChartSeries(
  shopDomain: string,
  range: HomeDateRange,
  compare: HomeCompare,
): Promise<HomeChartSeries | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const timeZone = store.timezone?.trim() || "UTC";
  const dayCount = range === "7" ? 7 : 30;
  const currentKeys = trailingDayKeys(dayCount, timeZone);
  const comparing = compare === "previous";
  const previousKeys = comparing ? previousDayKeys(currentKeys) : [];

  if (currentKeys.length !== dayCount) {
    throw new Error(
      `Expected ${dayCount} current day keys, got ${currentKeys.length}`,
    );
  }
  if (comparing && previousKeys.length !== dayCount) {
    throw new Error(
      `Expected ${dayCount} previous day keys, got ${previousKeys.length}`,
    );
  }

  const [currentCounts, previousCounts] = await Promise.all([
    countInvoicesByDay(store.id, currentKeys, timeZone),
    comparing
      ? countInvoicesByDay(store.id, previousKeys, timeZone)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const points: HomeChartPoint[] = currentKeys.map((key, index) => {
    const prevKey = previousKeys[index] ?? null;
    return {
      day: index + 1,
      label: shortLabelForDayKey(key),
      current: currentCounts.get(key) ?? 0,
      previous: comparing && prevKey ? (previousCounts.get(prevKey) ?? 0) : null,
      currentDate: key,
      previousDate: prevKey,
    };
  });

  return {
    range,
    compare,
    points,
    emptyCurrentPeriod: points.every((point) => point.current === 0),
  };
}

/** Initial page load: setup gate, or totals + default chart. */
export async function loader({
  request,
}: LoaderFunctionArgs): Promise<HomeLoaderData> {
  const { session } = await authenticate.admin(request);
  const setupState = await getInitialSetupState(session.shop);
  const initialSetup =
    setupState?.locked === true ? toHomeInitialSetup(setupState) : null;

  if (initialSetup) {
    return {
      initialSetup,
      totals: null,
      totalsError: null,
      chart: null,
      chartError: null,
    };
  }

  let totals: HomeTotals | null = null;
  let totalsError: string | null = null;
  let chart: HomeChartSeries | null = null;
  let chartError: string | null = null;

  try {
    totals = await getHomeTotals(session.shop);
    if (!totals) {
      totalsError = "We couldn't load the metrics";
    }
  } catch (error) {
    console.error("[home] totals error:", error);
    totalsError = "We couldn't load the metrics";
  }

  try {
    chart = await getHomeChartSeries(
      session.shop,
      DEFAULT_RANGE,
      DEFAULT_COMPARE,
    );
    if (!chart) {
      chartError = "We couldn't load the chart";
    }
  } catch (error) {
    console.error("[home] chart error:", error);
    chartError = "We couldn't load the chart";
  }

  return { initialSetup: null, totals, totalsError, chart, chartError };
}

/** Chart refresh or Finish setup. */
export async function action({
  request,
}: ActionFunctionArgs): Promise<HomeActionData> {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "finish-setup") {
    const result = await finishInitialSetup(session.shop);
    if (!result.ok) {
      return {
        intent: "finish-setup",
        ok: false,
        error: result.error,
      };
    }
    return { intent: "finish-setup", ok: true, error: null };
  }

  if (intent !== "chart") {
    return {
      intent: "chart",
      chart: null,
      chartError: "We couldn't load the chart",
      range: DEFAULT_RANGE,
      compare: DEFAULT_COMPARE,
    };
  }

  const range = parseHomeDateRange(String(formData.get("range") ?? ""));
  const compare = parseHomeCompare(String(formData.get("compare") ?? ""));

  try {
    const chart = await getHomeChartSeries(session.shop, range, compare);
    if (!chart) {
      return {
        intent: "chart",
        chart: null,
        chartError: "We couldn't load the chart",
        range,
        compare,
      };
    }
    return { intent: "chart", chart, chartError: null, range, compare };
  } catch (error) {
    console.error("[home] chart action error:", error);
    return {
      intent: "chart",
      chart: null,
      chartError: "We couldn't load the chart",
      range,
      compare,
    };
  }
}
