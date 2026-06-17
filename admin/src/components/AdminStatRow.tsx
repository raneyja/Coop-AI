type AdminStatProps = {
  label: string;
  value: string | number;
  hint?: string;
};

export function AdminStatRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="admin-stat-row">{children}</div>;
}

export function AdminStat({ label, value, hint }: AdminStatProps): React.ReactElement {
  return (
    <div className="admin-stat">
      <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-coop-muted">{hint}</p> : null}
    </div>
  );
}
