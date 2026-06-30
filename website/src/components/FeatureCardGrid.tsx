type FeatureCard = {
  label: string;
  description: string;
};

export function FeatureCardGrid({
  items,
  compact = false,
  small = false
}: {
  items: readonly FeatureCard[];
  compact?: boolean;
  /** ~50% scale — padding, type, and grid width */
  small?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex flex-wrap justify-center gap-2"
          : small
            ? "mx-auto grid w-full max-w-xl gap-2 sm:grid-cols-2 lg:grid-cols-4"
            : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      }
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={
            compact
              ? "rounded-sm border border-coop-border bg-white px-2.5 py-1 font-mono text-[11px] text-coop-muted"
              : small
                ? "rounded-sm border border-coop-border bg-white p-2.5"
                : "rounded-sm border border-coop-border bg-white p-5"
          }
        >
          <p
            className={
              compact
                ? "font-medium text-gray-900"
                : small
                  ? "text-[11px] font-semibold leading-tight text-gray-900"
                  : "text-sm font-semibold text-gray-900"
            }
          >
            {item.label}
          </p>
          {!compact && (
            <p
              className={
                small
                  ? "mt-1 text-[10px] leading-snug text-coop-muted"
                  : "mt-2 text-sm leading-relaxed text-coop-muted"
              }
            >
              {item.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
