"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  convertUserUsageTier,
  fetchOrg,
  fetchOrgRepos,
  fetchUsers,
  inviteUser,
  resolveSeatUpgradeRequest,
  updateUser,
  type AdminUser,
  type OrgRepoAccessMode,
  type OrgRepoRecord,
  type SeatInventory,
  type SeatUpgradeRequest
} from "@/lib/coopApi";
import { convertSeatPreview } from "@/lib/billingCopy";
import { displayUsageTierName } from "@/lib/planNudge";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { InviteUserModal } from "@/components/InviteUserModal";
import { UserRepoGrantsModal } from "@/components/UserRepoGrantsModal";
import {
  isSoloSeatCount,
  usersBillingLink,
  usersInviteDisabledTitle,
  usersPageSubtitle,
  usersRepoAccessHint,
  usersSeatsPanelCopy
} from "@/lib/billingCopy";

const TABLE_ROLES = ["member", "admin"];
const TIER_PRICES = { pro: 25, pro_plus: 60, max: 100 } as const;
const TIER_OPTIONS = ["pro", "pro_plus", "max"] as const;

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [seats, setSeats] = useState(1);
  const [seatsUsed, setSeatsUsed] = useState(0);
  const [seatMix, setSeatMix] = useState<string | undefined>();
  const [neverFilled, setNeverFilled] = useState<SeatInventory | undefined>();
  const [pendingRequests, setPendingRequests] = useState<SeatUpgradeRequest[]>([]);
  const [defaultInviteTier, setDefaultInviteTier] = useState<string>("pro");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [indexedRepos, setIndexedRepos] = useState<OrgRepoRecord[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);
  const [orgPlan, setOrgPlan] = useState<string>("free");
  const [repoAccessMode, setRepoAccessMode] = useState<OrgRepoAccessMode>("all_indexed");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [grantsUser, setGrantsUser] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [usersResult, orgResult, reposResult] = await Promise.all([
      fetchUsers(),
      fetchOrg(),
      fetchOrgRepos()
    ]);
    setLoading(false);
    if (orgResult.ok && orgResult.data) {
      setOrgPlan(orgResult.data.plan);
      if (orgResult.data.repoAccessMode) {
        setRepoAccessMode(orgResult.data.repoAccessMode);
      }
    }
    if (reposResult.ok) {
      setIndexedRepos(
        (reposResult.data?.repos ?? []).filter(
          (repo) => repo.lightningEnabled && repo.indexStatus !== "disabled"
        )
      );
    }
    const result = usersResult;
    if (result.unavailable) {
      setUnavailable(true);
      setUsers([]);
      return;
    }
    setUnavailable(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load users.");
      return;
    }
    setUsers(result.data?.users ?? []);
    setSeats(result.data?.seats ?? 1);
    setSeatsUsed(result.data?.seatsUsed ?? 0);
    setSeatMix(result.data?.seatMix);
    setNeverFilled(result.data?.neverFilledSeats);
    setPendingRequests(result.data?.pendingUpgradeRequests ?? []);
    const inventory = result.data?.seatInventory;
    setDefaultInviteTier(
      inventory && inventory.max > 0 && inventory.pro === 0 && inventory.pro_plus === 0
        ? "max"
        : inventory && inventory.pro_plus > 0 && inventory.pro === 0
          ? "pro_plus"
          : "pro"
    );
  }, []);

  const teamInvitesBlocked = orgPlan === "free";
  const perUserAccess = repoAccessMode === "per_user";
  const seatsAvailable = Math.max(0, seats - seatsUsed);
  const atSeatCapacity = !loading && seatsUsed >= seats;
  const solo = !teamInvitesBlocked && isSoloSeatCount(seats);
  const pageSubtitle = usersPageSubtitle({ free: teamInvitesBlocked, solo });
  const seatsPanel = usersSeatsPanelCopy({
    free: teamInvitesBlocked,
    solo,
    seats,
    seatsUsed,
    seatsAvailable,
    atCapacity: atSeatCapacity
  });
  const billingLink = usersBillingLink({
    free: teamInvitesBlocked,
    solo,
    atCapacity: atSeatCapacity
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }
    const timer = window.setTimeout(() => setSuccessMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  async function handleInvite(payload: {
    email: string;
    role: "member" | "admin";
    repoIds?: string[];
    usageTier?: "pro" | "pro_plus" | "max";
  }) {
    const result = await inviteUser(payload.email, payload.role, payload.repoIds, payload.usageTier);
    if (!result.ok) {
      throw new Error(result.error ?? "Invite failed.");
    }
    setSuccessMessage(`Invite sent to ${payload.email}.`);
    void load();
  }

  async function handleRoleChange(userId: string, role: string) {
    setActionId(userId);
    const result = await updateUser(userId, { role });
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Update failed.");
      return;
    }
    void load();
  }

  async function handleDeactivate(userId: string) {
    setActionId(userId);
    const result = await updateUser(userId, { status: "deactivated" });
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Deactivate failed.");
      return;
    }
    void load();
  }

  async function handleConvertTier(userId: string, usageTier: string, fromTier?: string | null) {
    const from = fromTier === "pro_plus" || fromTier === "max" ? fromTier : "pro";
    const to = usageTier === "pro_plus" || usageTier === "max" ? usageTier : "pro";
    if (from === to) {
      return;
    }
    const fromName = displayUsageTierName(from);
    const toName = displayUsageTierName(to);
    const fromUsd = TIER_PRICES[from];
    const toUsd = TIER_PRICES[to];
    if (!window.confirm(convertSeatPreview(fromName, toName, fromUsd, toUsd))) {
      return;
    }
    setActionId(userId);
    const result = await convertUserUsageTier(userId, usageTier);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not convert this seat.");
      return;
    }
    setSuccessMessage(`Converted this person's seat to ${toName}.`);
    void load();
  }

  async function handleUpgradeRequest(requestId: string, action: "confirm" | "deny") {
    setActionId(requestId);
    const result = await resolveSeatUpgradeRequest(requestId, action);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not update that request.");
      return;
    }
    setSuccessMessage(action === "confirm" ? "Seat upgrade confirmed." : "Seat upgrade denied.");
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Users</h1>
          <p className="mt-1 text-sm text-coop-muted">{pageSubtitle}</p>
        </div>
        {!teamInvitesBlocked ? (
          solo && atSeatCapacity ? (
            <Link href="/billing" className="admin-btn-primary">
              Add a teammate
            </Link>
          ) : (
            <button
              type="button"
              className="admin-btn-primary"
              disabled={unavailable || loading || atSeatCapacity}
              title={atSeatCapacity ? usersInviteDisabledTitle(solo) : undefined}
              onClick={() => setInviteOpen(true)}
            >
              Invite a new user
            </button>
          )
        ) : null}
      </div>

      {!unavailable && !loading ? (
        <div className="admin-panel-inset flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="admin-section-label">{seatsPanel.heading}</p>
            {seatsPanel.justYou ? (
              <p className="mt-1 text-sm text-white">Just you</p>
            ) : seatsPanel.assignedLine ? (
              <p className="mt-1 text-sm text-white">
                <span className="font-semibold tabular-nums">{seatsPanel.assignedLine.used}</span>
                <span className="text-coop-muted">{seatsPanel.assignedLine.of}</span>
                <span className="font-semibold tabular-nums">{seatsPanel.assignedLine.total}</span>
                <span className="text-coop-muted">{seatsPanel.assignedLine.suffix}</span>
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-coop-muted">{seatsPanel.hint}</p>
            {seatMix ? <p className="mt-1 text-xs text-coop-muted">{seatMix}</p> : null}
          </div>
          <Link
            href="/billing"
            className={billingLink.emphasized ? "admin-btn-secondary text-xs" : "admin-link text-xs"}
          >
            {billingLink.label}
          </Link>
        </div>
      ) : null}

      {!teamInvitesBlocked && !unavailable && !loading ? (
        <div className="admin-panel-inset flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="admin-section-label">Repository access</p>
            {perUserAccess ? (
              <>
                <p className="mt-1 text-sm text-white">Per-user grants</p>
                <p className="mt-0.5 text-xs text-coop-muted">
                  {usersRepoAccessHint({ solo, perUserAccess: true })}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-white">All indexed repos</p>
                <p className="mt-0.5 text-xs text-coop-muted">
                  {usersRepoAccessHint({ solo, perUserAccess: false })}
                </p>
              </>
            )}
          </div>
          <Link href="/settings/repository-access" className="admin-btn-secondary shrink-0 text-xs">
            Change access policy
          </Link>
        </div>
      ) : null}

      {unavailable && <UnavailableBanner />}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}

      {pendingRequests.length > 0 ? (
        <div className="admin-panel-inset space-y-3">
          <p className="admin-section-label">Upgrade requests</p>
          {pendingRequests.map((request) => {
            const member = users.find((user) => user.id === request.userId);
            return (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white">
                  {member?.email ?? request.userId} asked to convert their seat to{" "}
                  {displayUsageTierName(
                    request.toTier === "pro_plus" || request.toTier === "max" ? request.toTier : "pro"
                  )}
                  .
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="admin-btn-primary text-xs"
                    disabled={actionId === request.id}
                    onClick={() => void handleUpgradeRequest(request.id, "confirm")}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="admin-btn-secondary text-xs"
                    disabled={actionId === request.id}
                    onClick={() => void handleUpgradeRequest(request.id, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-coop-muted">
                  {unavailable ? "User list unavailable — check API connection." : "No users yet."}
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <select
                      className="admin-input max-w-[120px] py-1"
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      disabled={actionId === user.id || user.status === "deactivated"}
                    >
                      {TABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {orgPlan === "pro" && user.status !== "deactivated" ? (
                      <select
                        className="admin-input max-w-[120px] py-1"
                        value={user.usageTier === "pro_plus" || user.usageTier === "max" ? user.usageTier : "pro"}
                        onChange={(e) => void handleConvertTier(user.id, e.target.value, user.usageTier)}
                        disabled={actionId === user.id}
                      >
                        {TIER_OPTIONS.map((tier) => (
                          <option key={tier} value={tier}>
                            {displayUsageTierName(tier)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      displayUsageTierName(
                        user.usageTier === "pro_plus" || user.usageTier === "max" ? user.usageTier : "pro"
                      )
                    )}
                  </td>
                  <td className="capitalize">{user.status}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {perUserAccess && user.status !== "deactivated" ? (
                        <button
                          type="button"
                          className="admin-btn-secondary text-xs"
                          onClick={() => setGrantsUser(user)}
                        >
                          Manage repos
                        </button>
                      ) : null}
                      {user.status !== "deactivated" ? (
                        <button
                          type="button"
                          className="admin-btn-danger text-xs"
                          onClick={() => handleDeactivate(user.id)}
                          disabled={actionId === user.id}
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <InviteUserModal
        open={inviteOpen}
        perUserAccess={perUserAccess}
        indexedRepos={indexedRepos}
        neverFilledSeats={neverFilled}
        defaultUsageTier={defaultInviteTier}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
      />

      {grantsUser ? (
        <UserRepoGrantsModal
          open
          userId={grantsUser.id}
          userEmail={grantsUser.email}
          onClose={() => setGrantsUser(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
