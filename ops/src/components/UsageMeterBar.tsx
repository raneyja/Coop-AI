export function UsageMeterBar({
  ratio,
  label,
  size = "sm"
}: {
  ratio: number | null | undefined;
  label?: string;
  size?: "sm" | "lg";
}) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return <span className="text-xs text-coop-muted">{label ?? "—"}</span>;
  }
  const pct = Math.max(0, Math.round(ratio * 100));
  const width = Math.min(100, pct);
  const tone = ratio >= 1 ? "bg-red-400" : ratio >= 0.8 ? "bg-coop-warn" : "bg-coop-index";
  const barHeight = size === "lg" ? "h-2.5" : "h-1.5";
  const labelClass = ratio >= 0.8 ? "text-coop-warn" : "text-coop-muted";
  return (
    <div className={size === "lg" ? "w-full" : "min-w-[88px]"}>
      <div
        className={`flex overflow-hidden rounded-full bg-white/10 ${barHeight}`}
        role="img"
        aria-label={`${pct}% of plan`}
      >
        {width > 0 ? <div className={`h-full ${tone}`} style={{ width: `${width}%` }} /> : null}
      </div>
      <p className={`${size === "lg" ? "mt-2 text-sm" : "mt-1 text-xs"} ${labelClass}`}>
        {label ?? `${pct}%`}
      </p>
    </div>
  );
}
