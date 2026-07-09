export function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-coop-border/30 py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-x-6">
      <dt className="text-sm text-coop-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-white">{children}</dd>
    </div>
  );
}
