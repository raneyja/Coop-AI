"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchOrg,
  fetchOrgRepos,
  fetchUsers,
  inviteUser,
  updateUser,
  type AdminUser,
  type OrgRepoAccessMode,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { InviteUserModal } from "@/components/InviteUserModal";
import { UserRepoGrantsModal } from "@/components/UserRepoGrantsModal";

const TABLE_ROLES = ["member", "admin"];

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
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
  }, []);

  const teamInvitesBlocked = orgPlan === "free";
  const perUserAccess = repoAccessMode === "per_user";

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
  }) {
    const result = await inviteUser(payload.email, payload.role, payload.repoIds);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Users</h1>
          <p className="mt-1 text-sm text-coop-muted">
            {teamInvitesBlocked
              ? "Free plan is individual only — upgrade to Pro to invite teammates."
              : "Manage team members, roles, and access."}
          </p>
        </div>
        {!teamInvitesBlocked ? (
          <button
            type="button"
            className="admin-btn-primary"
            disabled={unavailable || loading}
            onClick={() => setInviteOpen(true)}
          >
            Invite a new user
          </button>
        ) : null}
      </div>

      {unavailable && <UnavailableBanner />}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}

      <div className="admin-card--table">
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
            {loading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
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

      {!teamInvitesBlocked ? (
        <p className="text-xs text-coop-muted">
          Repository access policy is configured in{" "}
          <Link href="/settings" className="admin-link">
            Settings
          </Link>
          .
        </p>
      ) : null}

      <InviteUserModal
        open={inviteOpen}
        perUserAccess={perUserAccess}
        indexedRepos={indexedRepos}
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
