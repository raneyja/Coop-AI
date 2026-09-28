"use client";

import {
  type ChartSeries,
  type MultiSeriesPoint,
  CHART_AXIS_FONT_SIZE,
  CHART_VIEW_HEIGHT,
  CHART_VIEW_WIDTH,
  chartPlotShellClassName,
  formatAxisUsdCents,
  formatDayLabel,
  niceMax,
  numericValues,
  pickTickIndices,
  seriesColor,
  yTicks
} from "./chartUtils";

export type CostLineChartProps = {
  data: MultiSeriesPoint[];
  series?: ChartSeries[];
  emptyLabel?: string;
  className?: string;
  maxXTicks?: number;
};

type PlotPoint = { day: string; values: Record<string, number> };

function normalizeData(data: MultiSeriesPoint[], seriesKeys: string[]): PlotPoint[] {
  return data.map((row) => {
    const values: Record<string, number> = {};
    for (const key of seriesKeys) {
      const raw = row[key];
      values[key] = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    }
    return { day: String(row.day), values };
  });
}

export function CostLineChart({
  data,
  series: seriesProp,
  emptyLabel = "No model cost in this range.",
  className,
  maxXTicks = 6
}: CostLineChartProps): React.ReactElement {
  const series =
    seriesProp && seriesProp.length > 0
      ? seriesProp
      : [
          { key: "autoCents", label: "Auto", color: seriesColor(0) },
          { key: "frontierCents", label: "Frontier", color: seriesColor(1) }
        ];

  const keys = series.map((s) => s.key);
  const points = normalizeData(data, keys);
  const hasSpend = points.some((p) => keys.some((key) => (p.values[key] ?? 0) > 0));
  const empty = points.length === 0 || !hasSpend;

  const values = numericValues(
    points.map((p) => p.values),
    keys
  );
  const maxY = niceMax(Math.max(0, ...values, 0));
  const ticks = yTicks(maxY, 4);
  const xTickIdx = pickTickIndices(points.length, maxXTicks);

  const width = CHART_VIEW_WIDTH;
  const height = CHART_VIEW_HEIGHT;
  const pad = { top: 16, right: 16, bottom: 32, left: 48 };
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
    <figure className={`min-w-0 ${className ?? ""}`.trim()} aria-label="LLM cost over time">
      {empty ? (
        <div
          className="flex h-48 items-center justify-center rounded-md border border-dashed border-coop-border/60 bg-white/[0.02] px-4 text-center text-sm text-coop-muted"
          role="status"
        >
          {emptyLabel}
        </div>
      ) : (
        <>
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
          <div className={chartPlotShellClassName}>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-full w-full"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="LLM cost over time"
            >
              {ticks.map((t) => {
                const y = yAt(t);
                return (
                  <g key={`y-${t}`}>
                    <line
                      x1={pad.left}
                      x2={width - pad.right}
                      y1={y}
                      y2={y}
                      stroke="#444A50"
                      strokeOpacity={0.55}
                      strokeWidth={1}
                    />
                    <text
                      x={pad.left - 10}
                      y={y}
                      textAnchor="end"
                      dominantBaseline="middle"
                      fill="#A1A9B1"
                      fontSize={CHART_AXIS_FONT_SIZE}
                      fontFamily="ui-monospace, monospace"
                    >
                      {formatAxisUsdCents(t)}
                    </text>
                  </g>
                );
              })}

              {xTickIdx.map((i) => {
                const p = points[i];
                if (!p) return null;
                return (
                  <text
                    key={`x-${p.day}-${i}`}
                    x={xAt(i)}
                    y={height - 10}
                    textAnchor="middle"
                    fill="#A1A9B1"
                    fontSize={CHART_AXIS_FONT_SIZE}
                    fontFamily="ui-monospace, monospace"
                  >
                    {formatDayLabel(p.day)}
                  </text>
                );
              })}

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
            </svg>
          </div>
        </>
      )}
    </figure>
  );
}
