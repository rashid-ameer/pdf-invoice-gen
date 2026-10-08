/**
 * Client-only Recharts line chart for Home dashboard.
 * Must only render after mount (parent gates on mounted).
 *
 * Comparison adds a second dashed line, legend, and both series in the tooltip.
 */
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  HomeChartPoint,
  HomeCompare,
  HomeDateRange,
} from "../models/dashboard";

/** Accent for current series — Shopify-like blue when tokens are unavailable. */
const CURRENT_LINE = "#2C6ECB";
/** Previous series + muted chrome. */
const PREVIOUS_LINE = "#8C9196";
const GRID_LINE = "#E1E3E5";
const AXIS_TEXT = "#6D7175";

type HomeInvoiceChartProps = {
  points: HomeChartPoint[];
  range: HomeDateRange;
  compare: HomeCompare;
};

function formatDayLabel(isoDate: string): string {
  const noon = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(noon);
}

function tickInterval(pointCount: number): number {
  if (pointCount <= 7) return 0;
  if (pointCount <= 14) return 1;
  return Math.max(1, Math.floor(pointCount / 6) - 1);
}

export function HomeInvoiceChart({
  points,
  range,
  compare,
}: HomeInvoiceChartProps) {
  const comparing = compare === "previous";
  const rangeLabel = range === "7" ? "Last 7 days" : "Last 30 days";
  const previousLabel = range === "7" ? "Previous 7 days" : "Previous 30 days";
  const accessibilityLabel = comparing
    ? `Line chart of invoices generated per day for the ${rangeLabel.toLowerCase()} compared with the ${previousLabel.toLowerCase()}`
    : `Line chart of invoices generated per day for the ${rangeLabel.toLowerCase()}`;

  // Always use numbers when comparing (including 0) so Recharts draws the line.
  const data = points.map((point) => ({
    day: point.day,
    label: point.label,
    current: point.current,
    previous: comparing ? Number(point.previous ?? 0) : undefined,
    currentDate: point.currentDate,
    previousDate: comparing ? point.previousDate : null,
  }));

  const maxValue = data.reduce(
    (max, point) =>
      Math.max(max, point.current, comparing ? (point.previous ?? 0) : 0),
    0,
  );

  const invoiceWord = (count: number) =>
    count === 1 ? "invoice" : "invoices";

  return (
    <div
      role="img"
      aria-label={accessibilityLabel}
      style={{ width: "100%", height: 280 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid stroke={GRID_LINE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID_LINE }}
            interval={tickInterval(points.length)}
            minTickGap={12}
          />
          <YAxis
            allowDecimals={false}
            // Keep room above 0 so a flat previous-period line at 0 stays visible.
            domain={[0, Math.max(maxValue, 1)]}
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as
                | {
                    current: number;
                    previous?: number;
                    currentDate: string;
                    previousDate: string | null;
                  }
                | undefined;
              if (!point) return null;
              return (
                <div
                  style={{
                    background: "#ffffff",
                    border: `1px solid ${GRID_LINE}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#202223",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ color: CURRENT_LINE }}>
                    {formatDayLabel(point.currentDate)}: {point.current}{" "}
                    {invoiceWord(point.current)}
                  </div>
                  {comparing && point.previousDate ? (
                    <div style={{ color: PREVIOUS_LINE }}>
                      {formatDayLabel(point.previousDate)}: {point.previous ?? 0}{" "}
                      {invoiceWord(point.previous ?? 0)}
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
          {comparing ? (
            <Legend
              verticalAlign="top"
              height={28}
              formatter={(value) =>
                value === "current" ? rangeLabel : previousLabel
              }
            />
          ) : null}
          {comparing ? (
            <Line
              type="monotone"
              dataKey="previous"
              name="previous"
              stroke={PREVIOUS_LINE}
              strokeWidth={2}
              strokeDasharray="5 4"
              // Dots keep a flat zero line visible on the baseline.
              dot={{ r: 2, fill: PREVIOUS_LINE, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="current"
            name="current"
            stroke={CURRENT_LINE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
