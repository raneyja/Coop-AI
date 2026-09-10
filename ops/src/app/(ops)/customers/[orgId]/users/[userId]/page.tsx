"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getStoredMe } from "@/lib/auth";
import { canMutateSupport } from "@/lib/operatorRbac";
import {
  fetchOrganizationUser,
  formatDateTime,
  formatUsdFromCents,
  formatUsagePercent,
  planBadgeClass,
  planLabel,
  resendOrganizationInvite,
  usageTierLabel,
  type CustomerUserDetail,
  type OrgPlan
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { UsageMeterBar } from "@/components/UsageMeterBar";

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

      <section className="admin-card">
        <h2 className="admin-section-label">Usage vs plan</h2>
        <div>
          <p className="admin-stat-label">
            {usageTierLabel(user.usageTier)} seat · LLM cost this period
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
        {(user.autoCents != null || user.frontierCents != null) && (
          <p className="text-sm text-coop-muted">
            Auto {formatUsdFromCents(user.autoCents ?? 0)} · Frontier {formatUsdFromCents(user.frontierCents ?? 0)}
          </p>
        )}
        {user.capKind === "unlimited" ? (
          <p className="text-sm text-coop-muted">Enterprise seats have no included-$ cap. Cost is Coop’s LLM spend.</p>
        ) : null}
        {user.capKind === "free_credits" ? (
          <p className="text-sm text-coop-muted">Free credits are org-wide. This cost is this person’s LLM spend only.</p>
        ) : null}
        <div className="admin-mix">
          <span>Chat {user.productMix?.chat ?? 0}</span>
          <span>Completions {user.productMix?.completions ?? 0}</span>
          <span>Quick actions {user.productMix?.quickActions ?? 0}</span>
          <span>Lightning {user.productMix?.lightning ?? 0}</span>
        </div>
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Account</h2>
        <div className="admin-stat-row">
          <div className="admin-stat">
            <p className="admin-stat-label">Last active</p>
            <p className="admin-stat-value--quiet">{formatDateTime(user.lastActiveAt)}</p>
          </div>
          <div className="admin-stat">
            <p className="admin-stat-label">Last login</p>
            <p className="admin-stat-value--quiet">{formatDateTime(user.lastLoginAt)}</p>
          </div>
        </div>
        {me && canMutateSupport(me) && user.status !== "deactivated" ? (
          <form onSubmit={handleResend} className="mt-4">
            <button type="submit" className="admin-btn-secondary" disabled={busy}>
              {busy ? "Sending…" : user.status === "invited" ? "Resend invite" : "Resend activation"}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
