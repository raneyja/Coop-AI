"use client";

import {
  type DayCountPoint,
  niceMax,
  seriesColor
} from "./chartUtils";

export type AnalyticsSparklineProps = {
  data: DayCountPoint[];
  /** Numeric key; defaults to `count`. */
  valueKey?: "count" | string;
  className?: string;
  width?: number;
  height?: number;
  color?: string;
  /** Accessible label. */
  ariaLabel?: string;
};

/**
 * Compact inline trend for stat rows. Empty data renders a muted baseline.
 */
export function AnalyticsSparkline({
  data,
  valueKey = "count",
  className = "",
  width = 96,
  height = 28,
  color,
  ariaLabel = "Trend"
}: AnalyticsSparklineProps): React.ReactElement {
  const values = data.map((row) => {
    const raw = (row as Record<string, string | number>)[valueKey];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  });
  const empty = values.length === 0;
  const max = niceMax(Math.max(0, ...values, 0));
  const stroke = color ?? seriesColor(0);
  const pad = 2;

  const path =
    !empty &&
    values
      .map((v, i) => {
        const x =
          values.length === 1
            ? width / 2
            : pad + (i / (values.length - 1)) * (width - pad * 2);
        const y = pad + (height - pad * 2) - (v / max) * (height - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`inline-block align-middle ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {empty ? (
        <line
          x1={pad}
          x2={width - pad}
          y1={height / 2}
          y2={height / 2}
          stroke="#444A50"
          strokeWidth={1}
        />
      ) : (
        <path
          d={path || ""}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
