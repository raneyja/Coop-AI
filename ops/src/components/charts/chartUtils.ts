/** Shared helpers for Ops cost charts (SVG, zero deps). */

export type MultiSeriesPoint = { day: string } & Record<string, string | number>;

export type ChartSeries = {
  key: string;
  label?: string;
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

export const CHART_VIEW_WIDTH = 960;
export const CHART_VIEW_HEIGHT = 220;
export const CHART_AXIS_FONT_SIZE = 11;
export const chartPlotShellClassName = "h-[220px] w-full min-w-0";

export function seriesColor(index: number, override?: string): string {
  if (override) return override;
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

export function niceMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const padded = raw * 1.08;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function formatAxisUsdCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (Number.isInteger(dollars)) return `$${dollars}`;
  if (Math.abs(dollars) < 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(1)}`;
}

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
