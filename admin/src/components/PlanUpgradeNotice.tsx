import Link from "next/link";

type PlanUpgradeNoticeProps = {
  message: string;
  ctaLabel?: string;
  href?: string;
  className?: string;
};

/** Prominent upgrade copy for free-plan feature gates (users, team features, etc.). */
export function PlanUpgradeNotice({
  message,
  ctaLabel = "Upgrade to Pro",
  href = "/billing",
  className = ""
}: PlanUpgradeNoticeProps) {
  return (
    <div className={`rounded-md border border-coop-index/30 bg-coop-index/10 px-4 py-3 ${className}`.trim()}>
      <p className="text-sm font-semibold leading-relaxed text-white">{message}</p>
      <div className="mt-3">
        <Link href={href} className="admin-btn-primary">
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
