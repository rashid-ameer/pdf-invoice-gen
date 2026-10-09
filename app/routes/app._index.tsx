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
    <s-page heading="Home">
      <s-section>
        <HomeSetupPanel
          setup={setup}
          finishError={
            finishFetcher.data?.intent === "finish-setup" &&
            !finishFetcher.data.ok
              ? finishFetcher.data.error
              : null
          }
          onFinish={finishSetup}
          finishing={finishing}
        />
      </s-section>
    </s-page>
  );
}

/** Post-Finish Setup on the unlocked dashboard — dismissible, no Finish button. */
function DismissibleHomeSetup({ setup }: { setup: HomeInitialSetup }) {
  const shopify = useAppBridge();
  const dismissFetcher = useFetcher<HomeActionData>();
  const dismissing =
    dismissFetcher.state === "submitting" || dismissFetcher.state === "loading";

  useEffect(() => {
    if (dismissFetcher.state !== "idle" || !dismissFetcher.data) return;
    if (dismissFetcher.data.intent !== "dismiss-setup") return;
    if (dismissFetcher.data.ok) {
      shopify.toast.show("Setup dismissed");
      return;
    }
    shopify.toast.show(
      dismissFetcher.data.error || "Couldn't dismiss setup",
      { isError: true },
    );
  }, [dismissFetcher.state, dismissFetcher.data, shopify]);

  const dismissSetup = () => {
    if (dismissing) return;
    const body = new FormData();
    body.set("intent", "dismiss-setup");
    dismissFetcher.submit(body, { method: "post" });
  };

  return (
    <HomeSetupPanel
      setup={setup}
      dismissible
      onDismiss={dismissSetup}
      dismissing={dismissing}
      dismissError={
        dismissFetcher.data?.intent === "dismiss-setup" &&
        !dismissFetcher.data.ok
          ? dismissFetcher.data.error
          : null
      }
    />
  );
}

function HomeSetupPanel({
  setup,
  dismissible = false,
  onDismiss,
  dismissing = false,
  dismissError = null,
  onFinish,
  finishing = false,
  finishError = null,
}: {
  setup: HomeInitialSetup;
  dismissible?: boolean;
  onDismiss?: () => void;
  dismissing?: boolean;
  dismissError?: string | null;
  onFinish?: () => void;
  finishing?: boolean;
  finishError?: string | null;
}) {
  const templatesHref = setup.nextTemplateType
    ? initialSetupTemplateHref(setup.nextTemplateType)
    : "/app/settings/templates?setup=1";

  const [expanded, setExpanded] = useState({
    company: !setup.companyComplete,
    templates: setup.companyComplete && !setup.templatesComplete,
  });

  return (
    <s-stack gap="base">
      <s-stack
        direction="inline"
        gap="base"
        justifyContent="space-between"
        alignItems="start"
      >
        <s-stack gap="small-200">
          <s-heading>Setup</s-heading>
          <s-paragraph>
            {dismissible
              ? "Your store is ready. You can review setup steps below or dismiss this section."
              : "Get your store ready for sending invoices. This takes 3–4 minutes. You can stop at any point and pick up from where you left."}
          </s-paragraph>
        </s-stack>
        {dismissible ? (
          <s-button
            variant="tertiary"
            tone="neutral"
            icon="x"
            accessibilityLabel="Dismiss setup"
            onClick={onDismiss}
            {...(dismissing ? { loading: true, disabled: true } : {})}
          />
        ) : null}
      </s-stack>

      {finishError ? (
        <s-banner tone="critical" heading="Couldn't finish setup">
          {finishError}
        </s-banner>
      ) : null}

      {dismissError ? (
        <s-banner tone="critical" heading="Couldn't dismiss setup">
          {dismissError}
        </s-banner>
      ) : null}

      <s-box border="base" borderRadius="base" background="base">
        <SetupAccordionItem
          complete={setup.companyComplete}
          title="Company Setup"
          description="Add your legal name, tax IDs, address, and invoice defaults."
          actionLabel="Setup company"
          actionHref="/app/settings/company"
          expanded={expanded.company}
          onToggle={() =>
            setExpanded((prev) => ({
              ...prev,
              company: !prev.company,
            }))
          }
        />
        <s-divider />
        <SetupAccordionItem
          complete={setup.templatesComplete}
          title="Default Templates"
          description="Choose a default template for invoices, packing slips, credit notes, and refund documents."
          actionLabel="Choose templates"
          actionHref={templatesHref}
          expanded={expanded.templates}
          onToggle={() =>
            setExpanded((prev) => ({
              ...prev,
              templates: !prev.templates,
            }))
          }
        />
      </s-box>

      {onFinish ? (
        <s-stack direction="inline" gap="base" justifyContent="end">
          <s-button
            variant="primary"
            onClick={onFinish}
            {...(setup.stagesComplete && !finishing ? {} : { disabled: true })}
            {...(finishing ? { loading: true } : {})}
          >
            Finish setup
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

function SetupAccordionItem({
  complete,
  title,
  description,
  actionLabel,
  actionHref,
  expanded,
  onToggle,
}: {
  complete: boolean;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <s-box>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <s-box padding="small">
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="base"
            alignItems="center"
          >
            <s-checkbox
              label={title}
              checked={complete || undefined}
              accessibilityLabel={
                complete ? `${title}: completed` : `${title}: incomplete`
              }
              onClick={(event: Event) => {
                // Completion is server-driven — keep header looking active, not disabled.
                event.preventDefault();
                event.stopPropagation();
                onToggle();
              }}
            />
            <s-button
              variant="tertiary"
              tone="neutral"
              icon={expanded ? "chevron-up" : "chevron-down"}
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}`}
              onClick={(event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggle();
              }}
            />
          </s-grid>
        </s-box>
      </div>

      {expanded ? (
        <s-box padding="small" paddingBlockStart="none">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="base">
              <s-paragraph>{description}</s-paragraph>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="primary" href={actionHref}>
                  {actionLabel}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-box>
      ) : null}
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
        {loaderData.initialSetup && !loaderData.initialSetup.locked ? (
          <s-section>
            <DismissibleHomeSetup setup={loaderData.initialSetup} />
          </s-section>
        ) : null}

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
