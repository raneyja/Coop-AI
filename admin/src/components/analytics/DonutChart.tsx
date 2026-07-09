"use client";

import { formatAxisNumber, seriesColor, type BarDatum } from "./chartUtils";
import { ChartFrame } from "./ChartFrame";

type DonutChartProps = {
  data: BarDatum[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  className?: string;
  /** Center label (e.g. total). */
  centerLabel?: string;
  centerValue?: string | number;
};

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, start);
  const o2 = polar(cx, cy, rOuter, end);
  const i1 = polar(cx, cy, rInner, end);
  const i2 = polar(cx, cy, rInner, start);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i2.x} ${i2.y}`,
    "Z"
  ].join(" ");
}

export function DonutChart({
  data,
  title,
  description,
  emptyLabel = "No product activity in this range.",
  className,
  centerLabel,
  centerValue
}: DonutChartProps): React.ReactElement {
  const positive = data.filter((d) => d.value > 0);
  const empty = positive.length === 0;
  const total = positive.reduce((sum, d) => sum + d.value, 0);
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 78;
  const rInner = 48;

  let angle = 0;
  const slices = positive.map((d, i) => {
    const sweep = total > 0 ? (d.value / total) * 360 : 0;
    // Avoid full-circle arc edge case
    const start = angle;
    const end = angle + Math.min(sweep, 359.99);
    angle += sweep;
    return {
      ...d,
      color: seriesColor(i),
      path: arcPath(cx, cy, rOuter, rInner, start, end),
      pct: total > 0 ? d.value / total : 0
    };
  });

  return (
    <ChartFrame
      title={title}
      description={description}
      empty={empty}
      emptyLabel={emptyLabel}
      className={className}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-44 w-44 shrink-0"
          role="img"
          aria-label={title ?? "Donut chart"}
        >
          {slices.map((s) => (
            <path key={s.label} d={s.path} fill={s.color}>
              <title>
                {s.label}: {s.value} ({Math.round(s.pct * 100)}%)
              </title>
            </path>
          ))}
          {(centerValue != null || centerLabel) && (
            <>
              {centerValue != null ? (
                <text
                  x={cx}
                  y={cy - (centerLabel ? 4 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-white"
                  fontSize={18}
                  fontWeight={600}
                >
                  {typeof centerValue === "number" ? formatAxisNumber(centerValue) : centerValue}
                </text>
              ) : null}
              {centerLabel ? (
                <text
                  x={cx}
                  y={cy + (centerValue != null ? 16 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-coop-muted"
                  fontSize={10}
                >
                  {centerLabel}
                </text>
              ) : null}
            </>
          )}
        </svg>
        <ul className="min-w-0 flex-1 space-y-2 text-sm">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-2 text-coop-muted">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate capitalize text-white/90">{s.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-white/80">
                {formatAxisNumber(s.value)}
                <span className="ml-2 text-coop-muted">{Math.round(s.pct * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}
