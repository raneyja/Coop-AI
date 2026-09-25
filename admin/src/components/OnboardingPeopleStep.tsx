"use client";

import Link from "next/link";

type OnboardingPeopleStepProps = {
  memberCount: number | null;
};

export function OnboardingPeopleStep({ memberCount }: OnboardingPeopleStepProps): React.ReactElement {
  const countLabel =
    memberCount === null
      ? null
      : `${memberCount} ${memberCount === 1 ? "person" : "people"} on this account.`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-white">Invite your team</h3>
        <p className="mt-2 text-sm leading-relaxed text-coop-muted">
          Usable repos are already available to everyone on this account. Invite teammates when you
          add seats — they can open those repos as soon as they sign in.
          {countLabel ? ` ${countLabel}` : ""}
        </p>
      </div>

      <div className="rounded-md border border-coop-border/70 bg-coop-dark/50 px-4 py-3.5">
        <p className="text-sm font-medium text-white">Invites live on Users</p>
        <p className="mt-1 text-sm leading-relaxed text-coop-muted">
          Send invites now, or come back after setup. New people inherit Usable repos automatically.
        </p>
        <div className="mt-3">
          <Link href="/users" className="admin-btn-secondary">
            Open Users
          </Link>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-coop-muted">
        To limit a repo to specific people, change{" "}
        <Link href="/settings/repository-access" className="admin-link">
          repository access
        </Link>{" "}
        in Settings.
      </p>
    </div>
  );
}
