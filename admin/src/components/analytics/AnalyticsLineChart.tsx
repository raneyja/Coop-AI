"use client";

import {
  type ChartSeries,
  type DayCountPoint,
  type MultiSeriesPoint,
  formatAxisNumber,
  formatDayLabel,
  niceMax,
  numericValues,
  pickTickIndices,
  seriesColor,
  yTicks
} from "./chartUtils";
import { ChartFrame } from "./ChartFrame";

export type AnalyticsLineChartProps = {
  /** Single series `{ day, count }[]` or multi-series rows with numeric keys. */
  data: DayCountPoint[] | MultiSeriesPoint[];
  /** Series to plot. Defaults to `[{ key: "count" }]` for day/count data. */
  series?: ChartSeries[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  className?: string;
  height?: number;
  /** Max x-axis tick labels. */
  maxXTicks?: number;
  showLegend?: boolean;
};

type PlotPoint = { day: string; values: Record<string, number> };

function normalizeData(
  data: DayCountPoint[] | MultiSeriesPoint[],
  seriesKeys: string[]
): PlotPoint[] {
  return data.map((row) => {
    const values: Record<string, number> = {};
    for (const key of seriesKeys) {
      const raw = (row as Record<string, string | number>)[key];
      values[key] = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    }
    return { day: String(row.day), values };
  });
}

export function AnalyticsLineChart({
  data,
  series: seriesProp,
  title,
  description,
  emptyLabel = "No data for this range.",
  className,
  height = 220,
  maxXTicks = 6,
  showLegend = true
}: AnalyticsLineChartProps): React.ReactElement {
  const series =
    seriesProp && seriesProp.length > 0
      ? seriesProp
      : [{ key: "count", label: "Events", color: seriesColor(0) }];

  const keys = series.map((s) => s.key);
  const points = normalizeData(data, keys);
  const empty = points.length === 0;

  const values = numericValues(
    points.map((p) => p.values),
    keys
  );
  const maxY = niceMax(Math.max(0, ...values, 0));
  const ticks = yTicks(maxY, 4);
  const xTickIdx = pickTickIndices(points.length, maxXTicks);

  const pad = { top: 12, right: 12, bottom: 28, left: 40 };
  const width = 640;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const xAt = (i: number) =>
    points.length === 1
      ? pad.left + innerW / 2
      : pad.left + (i / Math.max(1, points.length - 1)) * innerW;

  const yAt = (v: number) => pad.top + innerH - (v / maxY) * innerH;

  const paths = series.map((s, si) => {
    const d = points
      .map((p, i) => {
        const x = xAt(i);
        const y = yAt(p.values[s.key] ?? 0);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { ...s, d, color: seriesColor(si, s.color) };
  });

  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      emptyLabel={emptyLabel}
      className={className}
      ariaLabel={title ?? "Line chart"}
    >
      {showLegend && series.length > 1 ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-hidden="true">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-coop-muted">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColor(i, s.color) }}
              />
              {s.label ?? s.key}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={title ?? "Time series chart"}
        >
          <title>{title ?? "Time series"}</title>

          {/* Grid + Y axis */}
          {ticks.map((t) => {
            const y = yAt(t);
            return (
              <g key={`y-${t}`}>
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
                  {formatAxisNumber(t)}
                </text>
              </g>
            );
          })}

          {/* X axis ticks */}
          {xTickIdx.map((i) => {
            const p = points[i];
            if (!p) return null;
            return (
              <text
                key={`x-${p.day}-${i}`}
                x={xAt(i)}
                y={height - 8}
                textAnchor="middle"
                fill="#9CA4AD"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {formatDayLabel(p.day)}
              </text>
            );
          })}

          {/* Lines */}
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* End dots for single series readability */}
          {series.length === 1 &&
            points.map((p, i) => (
              <circle
                key={`dot-${p.day}`}
                cx={xAt(i)}
                cy={yAt(p.values[keys[0]!] ?? 0)}
                r={points.length <= 40 ? 2.5 : 0}
                fill={seriesColor(0, series[0]?.color)}
              />
            ))}
        </svg>
      </div>
    </ChartFrame>
  );
}
