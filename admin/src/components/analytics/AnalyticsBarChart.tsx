"use client";

import {
  type BarDatum,
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

export function AnalyticsBarChart({
  data,
  title,
  description,
  emptyLabel = "No data for this range.",
  className,
  orientation = "horizontal",
  color,
  maxBars = 20,
  rowHeight = 28,
  valueLabel = "Value"
}: AnalyticsBarChartProps): React.ReactElement {
  const sorted = [...data]
    .filter((d) => typeof d.value === "number" && Number.isFinite(d.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxBars);

  const empty = sorted.length === 0;
  const max = niceMax(Math.max(0, ...sorted.map((d) => d.value), 0));
  const fill = color ?? seriesColor(0);
  const labelMax = orientation === "horizontal" ? 32 : 14;

  if (orientation === "vertical") {
    const pad = { top: 12, right: 8, bottom: 40, left: 40 };
    const width = 640;
    const height = 220;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const gap = 4;
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
        <div className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
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
                    x={pad.left - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="#9CA4AD"
                    fontSize={10}
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
                    y={height - 10}
                    textAnchor="middle"
                    fill="#9CA4AD"
                    fontSize={9}
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

  // Horizontal (default)
  const labelCol = 140;
  const valueCol = 48;
  const chartW = 420;
  const padY = 4;
  const height = Math.max(48, sorted.length * rowHeight + padY * 2);
  const barMaxW = chartW - 8;

  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      emptyLabel={emptyLabel}
      className={className}
      ariaLabel={title ?? "Bar chart"}
    >
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${labelCol + chartW + valueCol} ${height}`}
          className="h-auto w-full min-w-[320px]"
          role="img"
          aria-label={title ?? "Horizontal bar chart"}
        >
          <title>{title ?? valueLabel}</title>
          {sorted.map((d, i) => {
            const cy = padY + i * rowHeight + rowHeight / 2;
            const barW = max > 0 ? (d.value / max) * barMaxW : 0;
            const barH = Math.min(14, rowHeight - 10);
            return (
              <g key={`${d.label}-${i}`}>
                <text
                  x={labelCol - 8}
                  y={cy}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="#9CA4AD"
                  fontSize={11}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {truncateLabel(d.label, labelMax)}
                </text>
                <rect
                  x={labelCol}
                  y={cy - barH / 2}
                  width={Math.max(d.value > 0 ? 3 : 0, barW)}
                  height={barH}
                  fill={fill}
                  fillOpacity={0.85}
                  rx={2}
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </rect>
                <text
                  x={labelCol + chartW + 4}
                  y={cy}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fill="#e4e4e7"
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                >
                  {formatAxisNumber(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFrame>
  );
}
