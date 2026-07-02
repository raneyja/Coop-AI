"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import { UserRepoGrantsModal } from "@/components/UserRepoGrantsModal";
import { shortRepoName } from "@/lib/indexingProgress";

const ROLES = ["member", "admin", "owner"];

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteRepoIds, setInviteRepoIds] = useState<string[]>([]);
  const [indexedRepos, setIndexedRepos] = useState<OrgRepoRecord[]>([]);
  const [inviting, setInviting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [orgPlan, setOrgPlan] = useState<string>("free");
  const [repoAccessMode, setRepoAccessMode] = useState<OrgRepoAccessMode>("all_indexed");
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

  const inviteRepoOptions = useMemo(() => indexedRepos, [indexedRepos]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleInviteRepo(repoId: string) {
    setInviteRepoIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId]
    );
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    const result = await inviteUser(
      inviteEmail.trim(),
      inviteRole,
      perUserAccess ? inviteRepoIds : undefined
    );
    setInviting(false);
    if (!result.ok) {
      setError(result.error ?? "Invite failed.");
      return;
    }
    setInviteEmail("");
    setInviteRepoIds([]);
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
      <div>
        <h1 className="admin-page-title">Users</h1>
        <p className="mt-1 text-sm text-coop-muted">
          {teamInvitesBlocked
            ? "Free plan is individual only — one seat per account. Upgrade to Pro to invite teammates."
            : perUserAccess
              ? "Invite teammates and assign which Deep-Indexed repos each person can access."
              : "Invite teammates and manage roles. All members can access every Deep-Indexed repo."}
        </p>
      </div>

      {unavailable && <UnavailableBanner />}

      <form onSubmit={handleInvite} className="admin-card">
        <h2 className="admin-section-label">Invite user</h2>
        {teamInvitesBlocked ? (
          <p className="mb-3 text-sm text-coop-muted">
            Team invites require Pro. The free Developer plan never includes team accounts.
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="inviteEmail" className="admin-label">
              Email
            </label>
            <input
              id="inviteEmail"
              type="email"
              className="admin-input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              disabled={unavailable || teamInvitesBlocked}
            />
          </div>
          <div className="w-36">
            <label htmlFor="inviteRole" className="admin-label">
              Role
            </label>
            <select
              id="inviteRole"
              className="admin-input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              disabled={unavailable || teamInvitesBlocked}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="admin-btn-primary" disabled={inviting || unavailable || teamInvitesBlocked}>
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
        {perUserAccess && !teamInvitesBlocked ? (
          <div className="mt-4 space-y-2">
            <p className="admin-section-label">Repository access</p>
            {inviteRepoOptions.length === 0 ? (
              <p className="text-sm text-coop-muted">
                No Deep-Indexed repos yet. Choose repos on the Indexing page first, or assign access after
                invite.
              </p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-coop-border/40 p-3">
                {inviteRepoOptions.map((repo) => (
                  <li key={repo.repoId}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-coop-index"
                        checked={inviteRepoIds.includes(repo.repoId)}
                        onChange={() => toggleInviteRepo(repo.repoId)}
                      />
                      <span className="font-mono text-white">{shortRepoName(repo.repoId)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-coop-muted">
              {inviteRepoIds.length} repo{inviteRepoIds.length === 1 ? "" : "s"} selected for this invite.
            </p>
          </div>
        ) : null}
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

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
                      {ROLES.map((r) => (
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
