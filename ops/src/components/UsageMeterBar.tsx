export function UsageMeterBar({
  ratio,
  label
}: {
  ratio: number | null | undefined;
  label?: string;
}) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return <span className="text-xs text-coop-muted">{label ?? "—"}</span>;
  }
  const pct = Math.max(0, Math.round(ratio * 100));
  const width = Math.min(100, pct);
  const tone = ratio >= 1 ? "bg-red-400" : ratio >= 0.8 ? "bg-coop-warn" : "bg-coop-index";
  return (
    <div className="min-w-[88px]">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${pct}% of plan`}>
        {width > 0 ? <div className={`h-full ${tone}`} style={{ width: `${width}%` }} /> : null}
      </div>
      <p className={`mt-1 text-xs ${ratio >= 0.8 ? "text-coop-warn" : "text-coop-muted"}`}>
        {label ?? `${pct}%`}
      </p>
    </div>
  );
}
