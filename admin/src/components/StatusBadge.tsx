type StatusBadgeProps = {
  connected: boolean;
  label?: string;
};

export function StatusBadge({ connected, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[11px] ${
        connected
          ? "border-coop-index/40 bg-coop-index/10 text-coop-index"
          : "border-coop-border bg-coop-dark text-coop-muted"
      }`}
    >
      {label ?? (connected ? "Connected" : "Not connected")}
    </span>
  );
}
