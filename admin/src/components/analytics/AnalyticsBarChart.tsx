"use client";

import {
  type BarDatum,
  CHART_AXIS_FONT_SIZE,
  CHART_VIEW_HEIGHT,
  CHART_VIEW_WIDTH,
  chartPlotShellClassName,
  formatAxisNumber,
  niceMax,
  seriesColor,
  truncateLabel
} from "./chartUtils";
import { ChartFrame } from "./ChartFrame";

export type AnalyticsBarChartProps = {
  data: BarDatum[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  className?: string;
  /** Prefer horizontal for long categorical labels (default). */
  orientation?: "horizontal" | "vertical";
  /** Bar fill; defaults to coop-index. */
  color?: string;
  /** Max bars before truncating (keeps chart readable). */
  maxBars?: number;
  /** Row height for horizontal layout. */
  rowHeight?: number;
  valueLabel?: string;
};

function HorizontalBarRows({
  data,
  max,
  fill
}: {
  data: BarDatum[];
  max: number;
  fill: string;
}): React.ReactElement {
  const peak = max > 0 ? max : 1;
  return (
    <div className="space-y-3 py-1">
      {data.map((d) => (
        <div
          key={d.label}
          className="grid grid-cols-[minmax(7rem,28%)_1fr_auto] items-center gap-3"
        >
          <span className="truncate text-sm text-coop-muted" title={d.label}>
            {d.label}
          </span>
          <div className="h-2.5 min-w-0 rounded-sm bg-coop-dark">
            <div
              className="h-2.5 rounded-sm"
              style={{
                width: `${Math.max(d.value > 0 ? 4 : 0, (d.value / peak) * 100)}%`,
                backgroundColor: fill,
                opacity: 0.85
              }}
            />
          </div>
          <span className="min-w-[2.5rem] text-right text-sm tabular-nums text-white/90">
            {formatAxisNumber(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsBarChart({
  data,
  title,
  description,
  emptyLabel = "No data for this range.",
  className,
  orientation = "horizontal",
  color,
  maxBars = 20,
  rowHeight = 32,
  valueLabel = "Value"
}: AnalyticsBarChartProps): React.ReactElement {
  const sorted = [...data]
    .filter((d) => typeof d.value === "number" && Number.isFinite(d.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxBars);

  const empty = sorted.length === 0;
  const max = niceMax(Math.max(0, ...sorted.map((d) => d.value), 0));
  const fill = color ?? seriesColor(0);
  const labelMax = 14;

  if (orientation === "horizontal") {
    return (
      <ChartFrame
        title={title}
        description={description}
        empty={empty}
        emptyLabel={emptyLabel}
        className={className}
        ariaLabel={title ?? "Bar chart"}
      >
        <HorizontalBarRows data={sorted} max={max} fill={fill} />
      </ChartFrame>
    );
  }

  const pad = { top: 16, right: 16, bottom: 40, left: 48 };
  const width = CHART_VIEW_WIDTH;
  const height = CHART_VIEW_HEIGHT;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gap = 6;
  const barW = sorted.length > 0 ? (innerW - gap * (sorted.length - 1)) / sorted.length : 0;

  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      emptyLabel={emptyLabel}
      className={className}
      ariaLabel={title ?? "Bar chart"}
    >
      <div className={chartPlotShellClassName}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={title ?? "Bar chart"}
        >
          <title>{title ?? "Bar chart"}</title>
          {[0, 0.5, 1].map((frac) => {
            const y = pad.top + innerH - frac * innerH;
            const v = max * frac;
            return (
              <g key={frac}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  stroke="#30363D"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 10}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="#9CA4AD"
                  fontSize={CHART_AXIS_FONT_SIZE}
                  fontFamily="ui-monospace, monospace"
                >
                  {formatAxisNumber(v)}
                </text>
              </g>
            );
          })}
          {sorted.map((d, i) => {
            const h = (d.value / max) * innerH;
            const x = pad.left + i * (barW + gap);
            const y = pad.top + innerH - h;
            return (
              <g key={`${d.label}-${i}`}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(1, barW)}
                  height={Math.max(1, h)}
                  fill={fill}
                  fillOpacity={0.85}
                  rx={2}
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={height - 12}
                  textAnchor="middle"
                  fill="#9CA4AD"
                  fontSize={CHART_AXIS_FONT_SIZE}
                  fontFamily="ui-monospace, monospace"
                >
                  {truncateLabel(d.label, labelMax)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFrame>
  );
}
