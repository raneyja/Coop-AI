"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getStoredMe } from "@/lib/auth";
import {
  canMutateBilling,
  canMutateSupport,
  canSuperAdmin,
  requiredRoleLabel
} from "@/lib/operatorRbac";
import {
  activateOrganization,
  createOrganizationApiKey,
  fetchOrganization,
  fetchOrganizationApiKeys,
  fetchOrganizationAudit,
  fetchOrganizationUsers,
  formatDate,
  formatDateTime,
  inviteOrganizationUser,
  manualProUpgrade,
  planBadgeClass,
  planLabel,
  provenanceLabel,
  reindexOrganizationEstate,
  resendOrganizationInvite,
  revokeAllOrganizationApiKeys,
  revokeOrganizationApiKey,
  createSeatChangeLink,
  stripeCustomerUrl,
  suspendOrganization,
  updateOrganization,
  updateOrganizationRepoAccess,
  type CustomerApiKey,
  type CustomerDetail,
  type CustomerUser,
  type OrgAuditEntry,
  type OrgPlan,
  type RepoAccessMode
} from "@/lib/coopApi";
import { ApiKeyRevealModal } from "@/components/ApiKeyRevealModal";
import { ConfirmOrgNameModal } from "@/components/ConfirmOrgNameModal";
import { StatusBadge } from "@/components/StatusBadge";
import { UnavailableBanner } from "@/components/UnavailableBanner";

export default function CustomerDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgId = String(params.orgId ?? "");
  const me = getStoredMe();
  const focus = searchParams.get("focus");

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  const [keys, setKeys] = useState<CustomerApiKey[]>([]);
  const [audit, setAudit] = useState<OrgAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState("");
  const [crmId, setCrmId] = useState("");
  const [seatInput, setSeatInput] = useState("");
  const [planInput, setPlanInput] = useState<OrgPlan>("pro");
  const [inviteEmail, setInviteEmail] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [seatChangeLink, setSeatChangeLink] = useState<string | null>(null);

  const [suspendModal, setSuspendModal] = useState(false);
  const [revokeAllModal, setRevokeAllModal] = useState(false);
  const [keyModal, setKeyModal] = useState<{ rawKey: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    const [detailRes, usersRes, keysRes, auditRes] = await Promise.all([
      fetchOrganization(orgId),
      fetchOrganizationUsers(orgId),
      fetchOrganizationApiKeys(orgId),
      fetchOrganizationAudit(orgId, { limit: 20 })
    ]);

    setLoading(false);

    if (detailRes.unavailable) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);

    if (!detailRes.ok || !detailRes.data) {
      setError(detailRes.error ?? "Failed to load customer.");
      return;
    }

    setDetail(detailRes.data);
    setNotes(detailRes.data.operatorNotes ?? "");
    setAssignee(detailRes.data.assignee ?? "");
    setCrmId(detailRes.data.crmExternalId ?? "");
    setSeatInput(String(detailRes.data.seats ?? ""));
    setPlanInput(detailRes.data.plan);

    if (usersRes.ok) setUsers(usersRes.data?.users ?? []);
    if (keysRes.ok) setKeys(keysRes.data?.keys ?? []);
    if (auditRes.ok) setAudit(auditRes.data?.entries ?? []);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focus || loading) return;
    const id = focus === "users" ? "ops-users" : focus === "billing" ? "ops-billing" : null;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, loading]);

  async function saveMetadata(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateSupport(me)) return;
    setBusy("metadata");
    setActionError(null);
    const result = await updateOrganization(orgId, {
      operatorNotes: notes.trim(),
      assignee: assignee.trim() || undefined,
      crmExternalId: crmId.trim() || undefined
    });
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to save notes.");
      return;
    }
    setDetail(result.data ?? null);
  }

  async function saveBilling(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateBilling(me) || detail?.stripe?.managed === true) return;
    setBusy("billing");
    setActionError(null);
    const seats = Number(seatInput);
    const result = await updateOrganization(orgId, {
      seats: Number.isFinite(seats) ? seats : undefined,
      plan: planInput
    });
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to update billing.");
      return;
    }
    setDetail(result.data ?? null);
  }

  async function handleSeatChangeLink(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateBilling(me)) return;
    const seats = Number(seatInput);
    if (!Number.isFinite(seats) || seats < 1) {
      setActionError("Enter a valid seat count.");
      return;
    }
    setBusy("seat-link");
    setActionError(null);
    setSeatChangeLink(null);
    const result = await createSeatChangeLink(orgId, seats);
    setBusy(null);
    if (!result.ok || !result.data?.url) {
      setActionError(result.error ?? "Failed to create seat-change link.");
      return;
    }
    setSeatChangeLink(result.data.url);
  }

  async function handleSuspend() {
    if (!me || !canSuperAdmin(me) || !detail) return;
    setBusy("suspend");
    setActionError(null);
    const result = await suspendOrganization(orgId, {
      confirmName: detail.name,
      reason: "Suspended by operator"
    });
    setBusy(null);
    setSuspendModal(false);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to suspend organization.");
      return;
    }
    void load();
  }

  async function handleActivate() {
    if (!me || !canSuperAdmin(me)) return;
    setBusy("activate");
    setActionError(null);
    const result = await activateOrganization(orgId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to activate organization.");
      return;
    }
    void load();
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateSupport(me)) return;
    setBusy("invite");
    setActionError(null);
    const result = await inviteOrganizationUser(orgId, inviteEmail);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to send invite.");
      return;
    }
    setInviteEmail("");
    void load();
  }

  async function handleResendInvite(userId: string) {
    if (!me || !canMutateSupport(me)) return;
    setBusy(`resend-${userId}`);
    const result = await resendOrganizationInvite(orgId, userId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to resend invite.");
      return;
    }
    if (result.data?.inviteLink) {
      await navigator.clipboard.writeText(result.data.inviteLink);
    }
  }

  async function handleCreateKey(e: FormEvent) {
    e.preventDefault();
    if (!me || !canMutateSupport(me)) return;
    setBusy("create-key");
    setActionError(null);
    const result = await createOrganizationApiKey(orgId, keyLabel.trim() || "API key");
    setBusy(null);
    if (!result.ok || !result.data) {
      setActionError(result.error ?? "Failed to create API key.");
      return;
    }
    setKeyLabel("");
    setKeyModal({ rawKey: result.data.rawKey, label: result.data.key.label });
    void load();
  }

  async function handleRevokeKey(keyId: string) {
    if (!me || !canMutateSupport(me)) return;
    if (!confirm("Revoke this API key? Applications using it will stop working.")) return;
    setBusy(`revoke-${keyId}`);
    const result = await revokeOrganizationApiKey(orgId, keyId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to revoke key.");
      return;
    }
    void load();
  }

  async function handleRevokeAll() {
    if (!me || !canSuperAdmin(me) || !detail) return;
    setBusy("revoke-all");
    const result = await revokeAllOrganizationApiKeys(orgId, detail.name);
    setBusy(null);
    setRevokeAllModal(false);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to revoke all keys.");
      return;
    }
    void load();
  }

  async function handleReindex() {
    if (!me || !canMutateSupport(me)) return;
    setBusy("reindex");
    setActionError(null);
    const result = await reindexOrganizationEstate(orgId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to queue reindex.");
      return;
    }
    alert(`Reindex queued: ${result.data?.queued ?? 0} jobs (${result.data?.discovered ?? 0} discovered).`);
  }

  async function handleRepoAccess(mode: RepoAccessMode) {
    if (!me || !canMutateSupport(me)) return;
    setBusy("repo-access");
    const result = await updateOrganizationRepoAccess(orgId, mode);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to update repo access.");
      return;
    }
    setDetail(result.data ?? null);
  }

  async function handleManualPro() {
    if (!me || !canMutateBilling(me)) return;
    setBusy("manual-pro");
    const result = await manualProUpgrade(orgId);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to upgrade to Pro.");
      return;
    }
    setDetail(result.data ?? null);
  }

  if (loading) {
    return <p className="text-coop-muted">Loading customer…</p>;
  }

  if (unavailable) {
    return (
      <div className="space-y-4">
        <Link href="/customers" className="admin-link text-sm">
          ← Customers
        </Link>
        <UnavailableBanner />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/customers" className="admin-link text-sm">
          ← Customers
        </Link>
        <p className="text-red-400">{error ?? "Customer not found."}</p>
      </div>
    );
  }

  const stripeId = detail.stripe?.customerId ?? detail.stripeCustomerId;
  const stripeManaged = detail.stripe?.managed === true;
  const planDrift =
    detail.stripe?.plan &&
    detail.coopBilling?.plan &&
    detail.stripe.plan !== detail.coopBilling.plan;
  const seatDrift =
    detail.stripe?.seats != null &&
    detail.coopBilling?.seats != null &&
    detail.stripe.seats !== detail.coopBilling.seats;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/customers" className="admin-link text-sm">
          ← Customers
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="admin-page-title">{detail.name}</h1>
            <p className="mt-1 font-mono text-xs text-coop-muted">{detail.id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={planBadgeClass(detail.plan)}>{planLabel(detail.plan)}</span>
            {detail.operatorStatus === "suspended" ? (
              <StatusBadge connected={false} label="Suspended" variant="danger" showWhenDisconnected />
            ) : (
              <StatusBadge connected label="Active" />
            )}
            <span className="admin-chip admin-chip--muted">{provenanceLabel(detail.provenance)}</span>
          </div>
        </div>
      </div>

      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      <section className="admin-card">
        <h2 className="admin-section-label">Health</h2>
        <div className="admin-stat-row mt-3">
          <div className="admin-stat">
            <p className="text-xs text-coop-muted">Integrations</p>
            <p className="mt-1 text-lg font-medium">{detail.health?.integrationsCount ?? "—"}</p>
          </div>
          <div className="admin-stat">
            <p className="text-xs text-coop-muted">Indexed repos</p>
            <p className="mt-1 text-lg font-medium">{detail.health?.indexedRepos ?? "—"}</p>
          </div>
          <div className="admin-stat">
            <p className="text-xs text-coop-muted">Indexing errors</p>
            <p className={`mt-1 text-lg font-medium ${(detail.health?.indexingErrors ?? 0) > 0 ? "text-coop-warn" : ""}`}>
              {detail.health?.indexingErrors ?? 0}
            </p>
          </div>
          <div className="admin-stat">
            <p className="text-xs text-coop-muted">Last admin login</p>
            <p className="mt-1 text-sm">{formatDateTime(detail.health?.lastAdminLogin)}</p>
          </div>
          <div className="admin-stat">
            <p className="text-xs text-coop-muted">Repo access</p>
            <p className="mt-1 text-sm font-mono">{detail.repoAccessMode ?? "all_indexed"}</p>
          </div>
        </div>
      </section>

      <section id="ops-billing" className="admin-card">
        <h2 className="admin-section-label">Billing & Stripe</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-coop-border/60 p-4">
            <p className="text-xs font-medium uppercase text-coop-muted">Coop</p>
            <p className="mt-2">
              {planLabel(detail.coopBilling?.plan ?? detail.plan)} · {detail.coopBilling?.seats ?? detail.seats ?? "—"} seats
            </p>
            <p className="text-sm text-coop-muted">Status: {detail.coopBilling?.status ?? detail.billingStatus ?? "—"}</p>
            {detail.coopBilling?.billingEmail && (
              <p className="text-sm text-coop-muted">{detail.coopBilling.billingEmail}</p>
            )}
          </div>
          <div className="rounded-md border border-coop-border/60 p-4">
            <p className="text-xs font-medium uppercase text-coop-muted">Stripe</p>
            {stripeId ? (
              <>
                <p className="mt-2">
                  {detail.stripe?.plan ? planLabel(detail.stripe.plan) : "—"} ·{" "}
                  {detail.stripe?.seats ?? "—"} seats
                </p>
                <p className="text-sm text-coop-muted">Status: {detail.stripe?.status ?? "—"}</p>
                <a
                  href={stripeCustomerUrl(stripeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-link mt-2 inline-block text-sm"
                >
                  Open in Stripe ↗
                </a>
              </>
            ) : (
              <p className="mt-2 text-sm text-coop-muted">No Stripe customer linked</p>
            )}
          </div>
        </div>
        {(planDrift || seatDrift) && (
          <p className="mt-3 text-sm text-coop-warn">
            Drift detected between Coop and Stripe
            {planDrift ? ` (plan: ${detail.coopBilling?.plan} vs ${detail.stripe?.plan})` : ""}
            {seatDrift ? ` (seats: ${detail.coopBilling?.seats} vs ${detail.stripe?.seats})` : ""}.
            Prefer fixing quantity in Stripe; Coop seats sync from the webhook after the customer confirms.
          </p>
        )}
        {stripeManaged && me && canMutateBilling(me) && (
          <div className="mt-4 space-y-3 rounded-md border border-coop-border/60 p-4">
            <p className="text-sm text-coop-muted">
              This org bills through Stripe. Coop does not change seats until the customer confirms a
              Stripe payment link. Do not edit Coop seats directly.
            </p>
            <p className="text-xs text-coop-muted">
              Requires Stripe Customer Portal → <strong className="font-medium text-white/80">Update quantities</strong>{" "}
              enabled for your Pro product (Settings → Billing → Customer portal).
            </p>
            <form onSubmit={handleSeatChangeLink} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="admin-label">Requested seats</label>
                <input
                  type="number"
                  min={1}
                  className="admin-input w-28"
                  value={seatInput}
                  onChange={(e) => setSeatInput(e.target.value)}
                />
              </div>
              <button type="submit" className="admin-btn-primary" disabled={busy === "seat-link"}>
                {busy === "seat-link" ? "Creating link…" : "Create Stripe approval link"}
              </button>
            </form>
            {seatChangeLink ? (
              <div className="space-y-2 break-all rounded-md bg-black/30 p-3 text-xs">
                <p className="text-coop-muted">Send this link to the customer billing contact:</p>
                <p className="font-mono text-white">{seatChangeLink}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="admin-btn-secondary"
                    onClick={() => void navigator.clipboard.writeText(seatChangeLink)}
                  >
                    Copy link
                  </button>
                  <a
                    href={seatChangeLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-btn-secondary inline-flex"
                  >
                    Open link ↗
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {me && canMutateBilling(me) && !stripeManaged && (
          <form onSubmit={saveBilling} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="admin-label">Plan</label>
              <select
                className="admin-input"
                value={planInput}
                onChange={(e) => setPlanInput(e.target.value as OrgPlan)}
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="admin-label">Seats</label>
              <input
                type="number"
                min={1}
                className="admin-input w-28"
                value={seatInput}
                onChange={(e) => setSeatInput(e.target.value)}
              />
            </div>
            <button type="submit" className="admin-btn-secondary" disabled={busy === "billing"}>
              {busy === "billing" ? "Saving…" : "Update billing"}
            </button>
            {detail.plan === "free" && (
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={handleManualPro}
                disabled={busy === "manual-pro"}
              >
                Manual Pro upgrade
              </button>
            )}
          </form>
        )}
        {me && canMutateBilling(me) && !stripeManaged && (
          <p className="mt-2 text-xs text-coop-muted">
            Manual (non-Stripe) billing only. Changes apply in Coop immediately — no customer payment step.
          </p>
        )}
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Internal metadata</h2>
        {me && canMutateSupport(me) ? (
          <form onSubmit={saveMetadata} className="mt-3 space-y-4">
            <div>
              <label className="admin-label">Notes</label>
              <textarea className="admin-input min-h-[100px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-[200px] flex-1">
                <label className="admin-label">Assignee</label>
                <input className="admin-input" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="admin-label">CRM external ID</label>
                <input className="admin-input" value={crmId} onChange={(e) => setCrmId(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="admin-btn-secondary" disabled={busy === "metadata"}>
              {busy === "metadata" ? "Saving…" : "Save metadata"}
            </button>
          </form>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            <p>{detail.operatorNotes || "No notes."}</p>
            <p className="text-coop-muted">Assignee: {detail.assignee ?? "—"}</p>
            <p className="text-coop-muted">CRM: {detail.crmExternalId ?? "—"}</p>
          </div>
        )}
      </section>

      <section id="ops-users" className="admin-card">
        <h2 className="admin-section-label">Users</h2>
        {me && canMutateSupport(me) && (
          <form onSubmit={handleInvite} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="admin-label">Invite admin</label>
              <input
                type="email"
                className="admin-input"
                placeholder="admin@customer.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <button type="submit" className="admin-btn-secondary" disabled={busy === "invite"}>
              Send invite
            </button>
          </form>
        )}
        <div className="admin-card--table mt-4">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-coop-muted">
                    No users yet.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td className="text-xs">{user.role}</td>
                    <td className="text-xs">{user.status}</td>
                    <td>
                      {user.status === "invited" && me && canMutateSupport(me) && (
                        <button
                          type="button"
                          className="admin-btn-secondary text-xs"
                          onClick={() => handleResendInvite(user.id)}
                          disabled={busy === `resend-${user.id}`}
                        >
                          Resend invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">API keys</h2>
        <p className="mt-1 text-sm text-coop-muted">
          Extension API keys for the VS Code plugin — not admin portal login credentials.
        </p>
        {me && canMutateSupport(me) && (
          <form onSubmit={handleCreateKey} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="admin-label">New key label</label>
              <input className="admin-input" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
            </div>
            <button type="submit" className="admin-btn-secondary" disabled={busy === "create-key"}>
              Create key
            </button>
            {me && canSuperAdmin(me) && keys.length > 0 && (
              <button
                type="button"
                className="admin-btn-danger"
                onClick={() => setRevokeAllModal(true)}
              >
                Revoke all
              </button>
            )}
          </form>
        )}
        <div className="admin-card--table mt-4">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-coop-muted">
                    No API keys.
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.label}</td>
                    <td className="text-xs">{formatDate(key.createdAt)}</td>
                    <td className="text-xs">{formatDate(key.lastUsedAt)}</td>
                    <td>
                      {me && canMutateSupport(me) && (
                        <button
                          type="button"
                          className="admin-btn-danger text-xs"
                          onClick={() => handleRevokeKey(key.id)}
                          disabled={busy === `revoke-${key.id}`}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Actions</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {me && canMutateSupport(me) && (
            <>
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={handleReindex}
                disabled={busy === "reindex"}
              >
                {busy === "reindex" ? "Queuing…" : "Reindex estate"}
              </button>
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => handleRepoAccess(detail.repoAccessMode === "per_user" ? "all_indexed" : "per_user")}
                disabled={busy === "repo-access"}
              >
                Set repo access: {detail.repoAccessMode === "per_user" ? "all indexed" : "per user"}
              </button>
            </>
          )}
          {me && canSuperAdmin(me) && (
            detail.operatorStatus === "suspended" ? (
              <button
                type="button"
                className="admin-btn-primary"
                onClick={handleActivate}
                disabled={busy === "activate"}
              >
                Activate organization
              </button>
            ) : (
              <button type="button" className="admin-btn-danger" onClick={() => setSuspendModal(true)}>
                Suspend organization
              </button>
            )
          )}
          {me && !canMutateSupport(me) && (
            <p className="text-sm text-coop-muted">
              Support actions require {requiredRoleLabel("support")}.
            </p>
          )}
        </div>
        {detail.operatorStatus === "suspended" && detail.suspendedReason && (
          <p className="mt-3 text-sm text-red-300">Suspended: {detail.suspendedReason}</p>
        )}
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Customer audit log</h2>
        <div className="admin-card--table mt-3">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-coop-muted">
                    No audit entries.
                  </td>
                </tr>
              ) : (
                audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-xs text-coop-muted">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="font-mono text-xs">{entry.action}</td>
                    <td className="text-xs text-coop-muted">{entry.principal ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmOrgNameModal
        open={suspendModal}
        title="Suspend organization"
        orgName={detail.name}
        description="Suspended organizations lose API access immediately. Extension keys and admin sessions return 403."
        confirmLabel="Suspend"
        onConfirm={handleSuspend}
        onClose={() => setSuspendModal(false)}
        loading={busy === "suspend"}
      />

      <ConfirmOrgNameModal
        open={revokeAllModal}
        title="Revoke all API keys"
        orgName={detail.name}
        description="All extension API keys for this organization will be revoked. Developers must create new keys."
        confirmLabel="Revoke all keys"
        onConfirm={handleRevokeAll}
        onClose={() => setRevokeAllModal(false)}
        loading={busy === "revoke-all"}
      />

      <ApiKeyRevealModal
        open={Boolean(keyModal)}
        rawKey={keyModal?.rawKey ?? ""}
        label={keyModal?.label ?? ""}
        onClose={() => setKeyModal(null)}
      />
    </div>
  );
}
