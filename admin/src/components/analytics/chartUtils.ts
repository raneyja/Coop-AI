/** Shared helpers for admin analytics charts (SVG, zero deps). */

export type DayCountPoint = { day: string; count: number };

export type MultiSeriesPoint = { day: string } & Record<string, string | number>;

export type BarDatum = { label: string; value: number };

export type ChartSeries = {
  /** Key on each data point (e.g. "count", "accepted"). */
  key: string;
  /** Legend / tooltip label. */
  label?: string;
  /** Stroke/fill color; defaults cycle coop palette. */
  color?: string;
};

export const CHART_COLORS = [
  "#3FB950", // coop-index
  "#58A6FF",
  "#D29922", // coop-warn
  "#A371F7",
  "#F778BA",
  "#79C0FF"
] as const;

export const CHART_SVG_CLASS = "mx-auto block h-[220px] w-full max-w-2xl";

export function seriesColor(index: number, override?: string): string {
  if (override) return override;
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

export function niceMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const padded = raw * 1.08;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/** Format ISO date or YYYY-MM-DD for axis ticks. */
export function formatDayLabel(day: string): string {
  const iso = day.includes("T") ? day : `${day}T00:00:00Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function pickTickIndices(length: number, maxTicks: number): number[] {
  if (length <= 0) return [];
  if (length <= maxTicks) {
    return Array.from({ length }, (_, i) => i);
  }
  const indices: number[] = [0];
  const step = (length - 1) / (maxTicks - 1);
  for (let i = 1; i < maxTicks - 1; i++) {
    indices.push(Math.round(i * step));
  }
  indices.push(length - 1);
  return [...new Set(indices)].sort((a, b) => a - b);
}

export function yTicks(max: number, count = 4): number[] {
  if (count < 2) return [0, max];
  return Array.from({ length: count }, (_, i) => (max * i) / (count - 1));
}

export function truncateLabel(label: string, max = 28): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

export function numericValues(
  data: Array<Record<string, string | number>>,
  keys: string[]
): number[] {
  const out: number[] = [];
  for (const row of data) {
    for (const key of keys) {
      const v = row[key];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}
