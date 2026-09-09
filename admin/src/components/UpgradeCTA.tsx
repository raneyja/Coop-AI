import Link from "next/link";

type UpgradeCTAProps = {
  variant?: "banner" | "inline";
  /** `request` = teammate seat request (green). `plan` = this org's plan upsell (purple). */
  tone?: "request" | "plan";
  title: string;
  body: string;
  ctaLabel?: string;
  href?: string;
  onAction?: () => void | Promise<void>;
  actionLoading?: boolean;
};

export function UpgradeCTA({
  variant = "inline",
  tone = "request",
  title,
  body,
  ctaLabel = "View billing",
  href = "/billing",
  onAction,
  actionLoading = false
}: UpgradeCTAProps) {
  const buttonClass = tone === "plan" ? "admin-btn-accent shrink-0" : "admin-btn-primary shrink-0";
  const actionButton = onAction ? (
    <button
      type="button"
      className={buttonClass}
      onClick={() => void onAction()}
      disabled={actionLoading}
    >
      {actionLoading ? "Redirecting…" : ctaLabel}
    </button>
  ) : (
    <Link href={href} className={buttonClass}>
      {ctaLabel}
    </Link>
  );

  if (variant === "banner") {
    const shell =
      tone === "plan"
        ? "rounded-md border border-coop-accent/30 bg-coop-accent/10 px-4 py-4"
        : "rounded-md border border-coop-index/25 bg-coop-index/10 px-4 py-4";
    return (
      <div className={shell}>
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
