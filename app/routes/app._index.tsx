import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { HomeInvoiceChart } from "../components/home-invoice-chart";
import {
  parseHomeCompare,
  parseHomeDateRange,
  type HomeChartActionData,
  type HomeCompare,
  type HomeDateRange,
  type HomeLoaderData,
} from "../models/dashboard";

export { action, loader } from "../models/dashboard.server";

/**
 * Metrics card composition — Shopify App Home pattern.
 * @see https://shopify.dev/docs/api/app-home/latest/patterns/compositions/metrics-card
 */
const METRIC_GRID_COLS =
  "@container (inline-size <= 400px) 1fr, 1fr auto 1fr auto 1fr";
/** Chart header: title left, dropdowns right; stack on narrow. */
const CHART_HEADER_COLS =
  "@container (inline-size > 480px) 1fr auto, 1fr";
const CHART_FILTER_COLS =
  "@container (inline-size > 480px) auto auto, 1fr 1fr";

const DEFAULT_RANGE: HomeDateRange = "30";
const DEFAULT_COMPARE: HomeCompare = "previous";

export default function HomePage() {
  const loaderData = useLoaderData<HomeLoaderData>();
  const navigation = useNavigation();
  const chartFetcher = useFetcher<HomeChartActionData>();

  const [range, setRange] = useState<HomeDateRange>(DEFAULT_RANGE);
  const [compare, setCompare] = useState<HomeCompare>(DEFAULT_COMPARE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const chartFromFetcher =
    chartFetcher.data?.intent === "chart" &&
    chartFetcher.data.range === range &&
    chartFetcher.data.compare === compare
      ? chartFetcher.data
      : null;

  const chartPayload = chartFromFetcher?.chart ?? loaderData.chart;
  const chartError = chartFromFetcher
    ? chartFromFetcher.chartError
    : loaderData.chartError;

  const chartLoading =
    chartFetcher.state === "loading" || chartFetcher.state === "submitting";

  const pageLoading =
    navigation.state === "loading" && !chartLoading && !loaderData.totals;

  const metrics: Array<{ label: string; value: number }> = useMemo(() => {
    const totals = loaderData.totals;
    return [
      { label: "Invoices", value: totals?.invoices ?? 0 },
      { label: "Credit notes", value: totals?.creditNotes ?? 0 },
      { label: "Emails sent", value: totals?.emailsSent ?? 0 },
    ];
  }, [loaderData.totals]);

  const reloadChart = (nextRange: HomeDateRange, nextCompare: HomeCompare) => {
    setRange(nextRange);
    setCompare(nextCompare);
    const body = new FormData();
    body.set("intent", "chart");
    body.set("range", nextRange);
    body.set("compare", nextCompare);
    chartFetcher.submit(body, { method: "post" });
  };

  const retryTotals = () => {
    window.location.reload();
  };

  const retryChart = () => {
    reloadChart(range, compare);
  };

  const activeChart =
    chartPayload &&
    chartPayload.range === range &&
    chartPayload.compare === compare
      ? chartPayload
      : chartLoading
        ? null
        : chartPayload;

  const emptyChartMessage =
    loaderData.totals && !loaderData.totals.hasAnyInvoices
      ? "No invoices yet"
      : "No invoices in this period";

  return (
    <s-page heading="Home">
      <s-stack gap="base">
        {loaderData.totalsError ? (
          <s-banner tone="critical" heading="We couldn't load the metrics">
            <s-button onClick={retryTotals}>Try again</s-button>
          </s-banner>
        ) : null}

        <s-query-container>
          <s-section padding="base">
            <s-grid gridTemplateColumns={METRIC_GRID_COLS} gap="small">
              {pageLoading || (!loaderData.totals && !loaderData.totalsError)
                ? metrics.flatMap((metric, index) => {
                    const card = (
                      <MetricCardLoading
                        key={metric.label}
                        label={metric.label}
                      />
                    );
                    if (index >= metrics.length - 1) return [card];
                    return [
                      card,
                      <s-divider
                        key={`${metric.label}-divider`}
                        direction="block"
                      />,
                    ];
                  })
                : metrics.flatMap((metric, index) => {
                    const card = (
                      <MetricCard
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                      />
                    );
                    if (index >= metrics.length - 1) return [card];
                    return [
                      card,
                      <s-divider
                        key={`${metric.label}-divider`}
                        direction="block"
                      />,
                    ];
                  })}
            </s-grid>
          </s-section>
        </s-query-container>

        <s-section>
          <s-stack gap="base">
            <s-query-container>
              <s-grid
                gridTemplateColumns={CHART_HEADER_COLS}
                gap="base"
                alignItems="end"
              >
                <s-stack gap="none">
                  <s-heading>Invoices generated</s-heading>
                  <s-text color="subdued">
                    Total number of invoices created over time.
                  </s-text>
                </s-stack>

                <s-grid gridTemplateColumns={CHART_FILTER_COLS} gap="small-200">
                  <s-select
                    label="Date range"
                    labelAccessibilityVisibility="exclusive"
                    value={range}
                    disabled={chartLoading || undefined}
                    onChange={(event: Event) => {
                      const value = (event.currentTarget as HTMLSelectElement)
                        .value;
                      reloadChart(parseHomeDateRange(value), compare);
                    }}
                  >
                    <s-option value="7">Last 7 days</s-option>
                    <s-option value="30">Last 30 days</s-option>
                  </s-select>
                  <s-select
                    label="Compare to"
                    labelAccessibilityVisibility="exclusive"
                    value={compare}
                    disabled={chartLoading || undefined}
                    onChange={(event: Event) => {
                      const value = (event.currentTarget as HTMLSelectElement)
                        .value;
                      reloadChart(range, parseHomeCompare(value));
                    }}
                  >
                    <s-option value="previous">Previous period</s-option>
                    <s-option value="none">No comparison</s-option>
                  </s-select>
                </s-grid>
              </s-grid>
            </s-query-container>

            {chartError ? (
              <s-banner tone="critical" heading="We couldn't load the chart">
                <s-button onClick={retryChart}>Try again</s-button>
              </s-banner>
            ) : chartLoading || !mounted || !activeChart ? (
              <s-stack alignItems="center" padding="large" gap="base">
                <s-spinner
                  accessibilityLabel="Loading chart"
                  size="large"
                />
              </s-stack>
            ) : activeChart.emptyCurrentPeriod ? (
              <s-stack alignItems="center" padding="large">
                <s-text color="subdued">{emptyChartMessage}</s-text>
              </s-stack>
            ) : (
              <HomeInvoiceChart
                key={`${activeChart.range}-${activeChart.compare}-${activeChart.points.length}`}
                points={activeChart.points}
                range={activeChart.range}
                compare={activeChart.compare}
              />
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <s-clickable
      paddingBlock="small-400"
      paddingInline="small-100"
      borderRadius="base"
      accessibilityLabel={`${label}: ${value.toLocaleString("en-US")}`}
    >
      <s-grid gap="small-300">
        <s-heading>{label}</s-heading>
        <s-text>{value.toLocaleString("en-US")}</s-text>
      </s-grid>
    </s-clickable>
  );
}

function MetricCardLoading({ label }: { label: string }) {
  return (
    <s-clickable
      paddingBlock="small-400"
      paddingInline="small-100"
      borderRadius="base"
      accessibilityLabel={`Loading ${label}`}
    >
      <s-grid gap="small-300">
        <s-heading>{label}</s-heading>
        <s-spinner accessibilityLabel={`Loading ${label}`} size="base" />
      </s-grid>
    </s-clickable>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
