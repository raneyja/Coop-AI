type ChartFrameProps = {
  title?: string;
  description?: string;
  empty?: boolean;
  emptyLabel?: string;
  className?: string;
  children: React.ReactNode;
  /** Accessible name for the chart region when title is omitted. */
  ariaLabel?: string;
};

/**
 * Shared chrome: optional title, empty state, and chart slot.
 * Loading is left to the parent (pass empty data + emptyLabel, or wrap with a skeleton).
 */
export function ChartFrame({
  title,
  description,
  empty = false,
  emptyLabel = "No data for this range.",
  className = "",
  children,
  ariaLabel
}: ChartFrameProps): React.ReactElement {
  return (
    <figure
      className={`min-w-0 ${className}`.trim()}
      aria-label={ariaLabel ?? title}
    >
      {(title || description) && (
        <figcaption className="mb-3">
          {title ? (
            <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">{title}</p>
          ) : null}
          {description ? <p className="mt-1 text-sm text-coop-muted">{description}</p> : null}
        </figcaption>
      )}
      {empty ? (
        <div
          className="flex h-48 items-center justify-center rounded-md border border-dashed border-coop-border/60 bg-white/[0.02] px-4 text-center text-sm text-coop-muted"
          role="status"
        >
          {emptyLabel}
        </div>
      ) : (
        children
      )}
    </figure>
  );
}
