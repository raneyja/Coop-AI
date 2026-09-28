"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getStoredMe } from "@/lib/auth";
import { canMutateSupport } from "@/lib/operatorRbac";
import {
  creditOrganizationUserUsage,
  fetchOrganizationUser,
  formatDateTime,
  formatUsdFromCents,
  formatUsagePercent,
  planBadgeClass,
  planLabel,
  resendOrganizationInvite,
  tokensToCredits,
  usageTierLabel,
  type CustomerUserDetail,
  type OrgPlan,
  type UsageCreditTargetRatio
} from "@/lib/coopApi";
import { ConfirmUsageCreditModal } from "@/components/ConfirmUsageCreditModal";
import { CustomerUsageCostPanel } from "@/components/CustomerUsageCostPanel";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { UsageMeterBar } from "@/components/UsageMeterBar";

const CREDIT_TARGETS: UsageCreditTargetRatio[] = [0.5, 0.25, 0];

function currentUsedRatio(user: CustomerUserDetail): number | null {
  if (user.capKind === "free_credits") {
    return user.free?.usedRatio ?? null;
  }
  if (user.capKind === "paid_included") {
    return user.usedRatio ?? null;
  }
  return null;
}

export default function CustomerUserPage() {
  const params = useParams();
  const orgId = String(params.orgId ?? "");
  const userId = String(params.userId ?? "");
  const me = getStoredMe();

  const [org, setOrg] = useState<{ id: string; name: string; plan: OrgPlan } | null>(null);
  const [user, setUser] = useState<CustomerUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creditTarget, setCreditTarget] = useState<UsageCreditTargetRatio | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !userId) return;
    setLoading(true);
    setError(null);
    const result = await fetchOrganizationUser(orgId, userId);
    setLoading(false);
    if (result.unavailable) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Failed to load user.");
      return;
    }
    setOrg(result.data.organization);
    setUser(result.data.user);
  }, [orgId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateSupport(me) || !user) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    const result = await resendOrganizationInvite(orgId, user.id);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to resend invite.");
      return;
    }
    if (result.data?.inviteLink) {
      try {
        await navigator.clipboard.writeText(result.data.inviteLink);
        setActionNotice("Invite link emailed and copied to clipboard.");
      } catch {
        setActionNotice("Invite emailed. Copy failed — check the email inbox.");
      }
    } else {
      setActionNotice("Invite emailed.");
    }
  }

  async function handleCredit(reason: string) {
    if (!me || !canMutateSupport(me) || !user || creditTarget == null) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    const result = await creditOrganizationUserUsage(orgId, user.id, {
      targetUsedRatio: creditTarget,
      reason
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      setActionError(result.error ?? "Failed to credit usage.");
      return;
    }
    const target = creditTarget;
    setUser(result.data.user);
    setCreditTarget(null);
    const label = `${Math.round(target * 100)}%`;
    setActionNotice(
      result.data.applied
        ? `Usage set to ${formatUsagePercent(result.data.afterUsedRatio)}.`
        : `Usage is already at or below ${label}.`
    );
  }

  if (loading) {
    return <p className="text-coop-muted">Loading user…</p>;
  }

  if (unavailable) {
    return (
      <div className="space-y-4">
        <Link href={`/customers/${orgId}`} className="admin-link text-sm">
          ← Customer
        </Link>
        <UnavailableBanner />
      </div>
    );
  }

  if (error || !user || !org) {
    return (
      <div className="space-y-4">
        <Link href={`/customers/${orgId}`} className="admin-link text-sm">
          ← Customer
        </Link>
        <p className="text-red-400">{error ?? "User not found."}</p>
      </div>
    );
  }

  const usedRatio = currentUsedRatio(user);
  const canCredit = Boolean(me && canMutateSupport(me) && user.capKind !== "unlimited");

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/customers/${orgId}?focus=users`} className="admin-link text-sm">
          ← {org.name}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="admin-page-title">{user.email}</h1>
            <p className="mt-1 font-mono text-xs text-coop-muted">{user.id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={planBadgeClass(org.plan)}>{planLabel(org.plan)}</span>
            <span className="admin-chip admin-chip--muted">{user.role}</span>
            <span className="admin-chip admin-chip--muted">{user.status}</span>
          </div>
        </div>
      </div>

      {actionError && <p className="text-sm text-red-400">{actionError}</p>}
      {actionNotice && <p className="text-sm text-coop-index">{actionNotice}</p>}

      <CustomerUsageCostPanel orgId={orgId} userId={user.id} />

      <section className="admin-card">
        <h2 className="admin-section-label">Plan allowance & credits</h2>
        {user.capKind === "free_credits" && user.free ? (
          <div className="mb-4">
            <p className="admin-stat-label">Org free credits (shared pool)</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {tokensToCredits(user.free.usedTokens)}K
              <span className="ml-2 text-base font-normal text-coop-muted">
                of {tokensToCredits(user.free.limitTokens)}K
              </span>
            </p>
            <div className="mt-3">
              <UsageMeterBar
                size="lg"
                ratio={user.free.usedRatio}
                label={`${formatUsagePercent(user.free.usedRatio)} of included`}
              />
            </div>
            <p className="mt-2 text-sm text-coop-muted">
              Free credits are org-wide. Crediting this person lowers the shared pool that blocks
              chat. This is not the same as Coop’s model $ cost above.
            </p>
          </div>
        ) : user.capKind === "paid_included" ? (
          <div>
            <p className="admin-stat-label">
              {usageTierLabel(user.usageTier)} seat · included this billing period
            </p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {formatUsdFromCents(user.usedCents)}
              {user.includedCents != null ? (
                <span className="ml-2 text-base font-normal text-coop-muted">
                  of {formatUsdFromCents(user.includedCents)}
                </span>
              ) : null}
            </p>
            {user.usedRatio != null ? (
              <div className="mt-3">
                <UsageMeterBar
                  size="lg"
                  ratio={user.usedRatio}
                  label={`${formatUsagePercent(user.usedRatio)} of included`}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-coop-muted">
            Enterprise seats have no included-$ cap. Cost above is Coop’s LLM spend.
          </p>
        )}
        {canCredit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {CREDIT_TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                className="admin-btn-secondary"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setActionNotice(null);
                  setCreditTarget(target);
                }}
              >
                Set to {Math.round(target * 100)}%
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Account</h2>
        <div className="admin-stat-row">
          <div className="admin-stat">
            <p className="admin-stat-label">Last login</p>
            <p className="admin-stat-value--quiet">{formatDateTime(user.lastLoginAt ?? undefined)}</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-label">Last active</p>
            <p className="admin-stat-value--quiet">{formatDateTime(user.lastActiveAt ?? undefined)}</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-label">Seat</p>
            <p className="admin-stat-value--quiet">{usageTierLabel(user.usageTier)}</p>
          </div>
        </div>
        {user.status !== "deactivated" && me && canMutateSupport(me) ? (
          <form onSubmit={handleResend} className="mt-4">
            <button type="submit" className="admin-btn-secondary" disabled={busy}>
              {busy
                ? "Sending…"
                : user.status === "invited"
                  ? "Resend invite"
                  : "Resend activation"}
            </button>
          </form>
        ) : null}
      </section>

      <ConfirmUsageCreditModal
        open={creditTarget != null}
        targetRatio={creditTarget}
        currentRatio={usedRatio}
        email={user.email}
        loading={busy}
        onClose={() => setCreditTarget(null)}
        onConfirm={(reason) => void handleCredit(reason)}
      />
    </div>
  );
}
