import { siteConfig } from "@/lib/site.config";

export function TrustBadges({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex flex-wrap justify-center gap-3"
          : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      }
    >
      {siteConfig.trustBadges.map((badge) => (
        <div
          key={badge.label}
          className={
            compact
              ? "rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-coop-muted"
              : "rounded-xl border border-white/10 bg-white/[0.03] p-5"
          }
        >
          <p className={compact ? "font-medium text-white/90" : "text-sm font-semibold text-white"}>
            {badge.label}
          </p>
          {!compact && (
            <p className="mt-2 text-sm leading-relaxed text-coop-muted">{badge.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
