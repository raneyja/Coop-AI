import Link from "next/link";

type UpgradeCTAProps = {
  variant?: "banner" | "inline";
  title: string;
  body: string;
  ctaLabel?: string;
  href?: string;
  onAction?: () => void | Promise<void>;
  actionLoading?: boolean;
};

export function UpgradeCTA({
  variant = "inline",
  title,
  body,
  ctaLabel = "View billing",
  href = "/billing",
  onAction,
  actionLoading = false
}: UpgradeCTAProps) {
  const actionButton = onAction ? (
    <button
      type="button"
      className="admin-btn-primary shrink-0"
      onClick={() => void onAction()}
      disabled={actionLoading}
    >
      {actionLoading ? "Redirecting…" : ctaLabel}
    </button>
  ) : (
    <Link href={href} className="admin-btn-primary shrink-0">
      {ctaLabel}
    </Link>
  );

  if (variant === "banner") {
    return (
      <div className="rounded-md border border-coop-index/25 bg-coop-index/10 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-sm text-coop-muted">{body}</p>
          </div>
          {actionButton}
        </div>
      </div>
    );
  }

  return (
    <p className="text-sm text-coop-muted">
      {body}{" "}
      {onAction ? (
        <button type="button" className="admin-link" onClick={() => void onAction()} disabled={actionLoading}>
          {actionLoading ? "Redirecting…" : ctaLabel}
        </button>
      ) : (
        <Link href={href} className="admin-link">
          {ctaLabel}
        </Link>
      )}
    </p>
  );
}
