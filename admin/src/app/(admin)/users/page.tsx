"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { fetchUsers, fetchOrg, inviteUser, updateUser, type AdminUser } from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { PlanUpgradeNotice } from "@/components/PlanUpgradeNotice";

const ROLES = ["member", "admin", "owner"];

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [orgPlan, setOrgPlan] = useState<string>("free");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [usersResult, orgResult] = await Promise.all([fetchUsers(), fetchOrg()]);
    setLoading(false);
    if (orgResult.ok && orgResult.data?.plan) {
      setOrgPlan(orgResult.data.plan);
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

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    const result = await inviteUser(inviteEmail.trim(), inviteRole);
    setInviting(false);
    if (!result.ok) {
      setError(result.error ?? "Invite failed.");
      return;
    }
    setInviteEmail("");
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
          {teamInvitesBlocked ? "Your personal account — one seat on the free Developer plan." : "Invite teammates and manage roles."}
        </p>
      </div>

      {unavailable && <UnavailableBanner />}

      <form onSubmit={handleInvite} className="admin-card">
        <h2 className="admin-section-label">Invite user</h2>
        {teamInvitesBlocked ? (
          <PlanUpgradeNotice
            className="mb-4"
            message="Inviting additional users requires a Pro subscription. Upgrade now to invite your team."
          />
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
                    {user.status !== "deactivated" && (
                      <button
                        type="button"
                        className="admin-btn-danger text-xs"
                        onClick={() => handleDeactivate(user.id)}
                        disabled={actionId === user.id}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
