import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { HomeInvoiceChart } from "../components/home-invoice-chart";
import {
  type HomeActionData,
  type HomeChartActionData,
  type HomeCompare,
  type HomeDateRange,
  type HomeInitialSetup,
  type HomeLoaderData,
} from "../models/dashboard";
import { initialSetupTemplateHref } from "../models/initial-setup";

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

const DEFAULT_RANGE: HomeDateRange = "30";
const DEFAULT_COMPARE: HomeCompare = "previous";
const RANGE_MENU_ID = "home-chart-range-menu";
const COMPARE_MENU_ID = "home-chart-compare-menu";

const RANGE_LABELS: Record<HomeDateRange, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
};

const COMPARE_LABELS: Record<HomeCompare, string> = {
  previous: "Previous period",
  none: "No comparison",
};

export default function HomePage() {
  const loaderData = useLoaderData<HomeLoaderData>();

  if (loaderData.initialSetup?.locked) {
    return <InitialSetupPage setup={loaderData.initialSetup} />;
  }

  return <HomeDashboard loaderData={loaderData} />;
}

function InitialSetupPage({ setup }: { setup: HomeInitialSetup }) {
  const shopify = useAppBridge();
  const finishFetcher = useFetcher<HomeActionData>();
  const finishing =
    finishFetcher.state === "submitting" || finishFetcher.state === "loading";

  const completedCount =
    (setup.companyComplete ? 1 : 0) + (setup.templatesComplete ? 1 : 0);

  const templatesHref = setup.nextTemplateType
    ? initialSetupTemplateHref(setup.nextTemplateType)
    : "/app/settings/templates?setup=1";

  useEffect(() => {
    if (finishFetcher.state !== "idle" || !finishFetcher.data) return;
    if (finishFetcher.data.intent !== "finish-setup") return;
    if (finishFetcher.data.ok) {
      shopify.toast.show("Setup complete");
      // Full navigation so app layout reloads and restores the sidebar.
      window.location.assign("/app");
      return;
    }
    shopify.toast.show(
      finishFetcher.data.error || "Couldn't finish setup",
      { isError: true },
    );
  }, [finishFetcher.state, finishFetcher.data, shopify]);

  const finishSetup = () => {
    if (finishing || !setup.stagesComplete) return;
    const body = new FormData();
    body.set("intent", "finish-setup");
    finishFetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading="Initial setup">
      <s-section>
        <s-stack gap="base">
          <s-stack gap="small-200">
            <s-heading>Get your app ready</s-heading>
            <s-paragraph>
              Complete these required steps before using invoices and other
              features.
            </s-paragraph>
            <s-text color="subdued">
              {completedCount} of 2 steps completed
            </s-text>
          </s-stack>

          {finishFetcher.data?.intent === "finish-setup" &&
          !finishFetcher.data.ok &&
          finishFetcher.data.error ? (
            <s-banner tone="critical" heading="Couldn't finish setup">
              {finishFetcher.data.error}
            </s-banner>
          ) : null}

          <s-box border="base" borderRadius="base" background="base">
            <s-stack gap="none">
              <SetupStepRow
                complete={setup.companyComplete}
                title="Company setup"
                description="Add your legal name, tax IDs, address, and invoice defaults."
                actionLabel={
                  setup.companyComplete ? "Review company" : "Complete company setup"
                }
                actionHref="/app/settings/company"
              />
              <s-divider />
              <SetupStepRow
                complete={setup.templatesComplete}
                title="Default templates"
                description="Choose a default template for invoices, packing slips, credit notes, and refund documents."
                actionLabel={
                  setup.templatesComplete
                    ? "Review templates"
                    : setup.companyComplete
                      ? "Choose templates"
                      : "Complete company setup first"
                }
                actionHref={
                  setup.companyComplete ? templatesHref : "/app/settings/company"
                }
                actionDisabled={!setup.companyComplete && !setup.templatesComplete}
              />
            </s-stack>
          </s-box>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button
              variant="primary"
              onClick={finishSetup}
              {...(setup.stagesComplete && !finishing
                ? {}
                : { disabled: true })}
              {...(finishing ? { loading: true } : {})}
            >
              Finish setup
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function SetupStepRow({
  complete,
  title,
  description,
  actionLabel,
  actionHref,
  actionDisabled,
}: {
  complete: boolean;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  actionDisabled?: boolean;
}) {
  return (
    <s-box padding="base">
      <s-grid
        gridTemplateColumns="auto 1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-checkbox
          label={title}
          checked={complete || undefined}
          disabled
          accessibilityLabel={
            complete ? `${title}: completed` : `${title}: incomplete`
          }
        />
        <s-stack gap="none">
          <s-text color="subdued">{description}</s-text>
        </s-stack>
        {complete ? (
          <s-badge tone="success">Completed</s-badge>
        ) : (
          <s-button
            variant="primary"
            href={actionHref}
            {...(actionDisabled ? { disabled: true } : {})}
          >
            {actionLabel}
          </s-button>
        )}
      </s-grid>
    </s-box>
  );
}

function HomeDashboard({ loaderData }: { loaderData: HomeLoaderData }) {
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

        <s-box
          padding="base"
          background="subdued"
          border="base"
          borderRadius="large"
        >
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="base"
            alignItems="center"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-icon type="question-circle" />
              <s-text>
                Need help with the Dashboard? Check the step-by-step guide.
              </s-text>
            </s-stack>
            <s-button href="/app/help" variant="secondary">
              View guide
            </s-button>
          </s-grid>
        </s-box>

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

                <s-stack direction="inline" gap="small-200">
                  <s-button
                    variant="secondary"
                    commandFor={RANGE_MENU_ID}
                    accessibilityLabel={`Date range: ${RANGE_LABELS[range]}`}
                    {...(chartLoading ? { disabled: true } : {})}
                  >
                    {RANGE_LABELS[range]}
                  </s-button>
                  <s-menu id={RANGE_MENU_ID} accessibilityLabel="Date range">
                    <s-button
                      onClick={() => reloadChart("7", compare)}
                      {...(range === "7" || chartLoading
                        ? { disabled: true }
                        : {})}
                    >
                      Last 7 days
                    </s-button>
                    <s-button
                      onClick={() => reloadChart("30", compare)}
                      {...(range === "30" || chartLoading
                        ? { disabled: true }
                        : {})}
                    >
                      Last 30 days
                    </s-button>
                  </s-menu>

                  <s-button
                    variant="secondary"
                    commandFor={COMPARE_MENU_ID}
                    accessibilityLabel={`Compare to: ${COMPARE_LABELS[compare]}`}
                    {...(chartLoading ? { disabled: true } : {})}
                  >
                    {COMPARE_LABELS[compare]}
                  </s-button>
                  <s-menu
                    id={COMPARE_MENU_ID}
                    accessibilityLabel="Compare to"
                  >
                    <s-button
                      onClick={() => reloadChart(range, "previous")}
                      {...(compare === "previous" || chartLoading
                        ? { disabled: true }
                        : {})}
                    >
                      Previous period
                    </s-button>
                    <s-button
                      onClick={() => reloadChart(range, "none")}
                      {...(compare === "none" || chartLoading
                        ? { disabled: true }
                        : {})}
                    >
                      No comparison
                    </s-button>
                  </s-menu>
                </s-stack>
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
