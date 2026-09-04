"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchMe,
  fetchOrg,
  fetchOrgRepos,
  fetchUserRepoGrants,
  fetchUsers,
  saveUserRepoGrants,
  updateRepoAccessMode,
  type OrgRepoAccessMode
} from "@/lib/coopApi";
import { getStoredMe } from "@/lib/auth";
import { isUsableForDeveloperAccess } from "@/lib/usableRepos";

type OnboardingPeopleStepProps = {
  memberCount: number | null;
};

export function OnboardingPeopleStep({ memberCount }: OnboardingPeopleStepProps): React.ReactElement {
  const me = getStoredMe();
  const [repoAccessMode, setRepoAccessMode] = useState<OrgRepoAccessMode>("all_indexed");
  const [usableRepoIds, setUsableRepoIds] = useState<string[]>([]);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [selfGranted, setSelfGranted] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [grantingSelf, setGrantingSelf] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSelfGrants = useCallback(async (userId: string, usableIds: string[]) => {
    const grants = await fetchUserRepoGrants(userId);
    if (!grants.ok || !grants.data) {
      setSelfGranted(false);
      return;
    }
    const granted = new Set(grants.data.repoIds);
    setSelfGranted(usableIds.some((id) => granted.has(id)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const [orgResult, reposResult, meResult, usersResult] = await Promise.all([
      fetchOrg(),
      fetchOrgRepos(),
      fetchMe(),
      fetchUsers()
    ]);

    if (orgResult.ok && orgResult.data?.repoAccessMode) {
      setRepoAccessMode(orgResult.data.repoAccessMode);
    }

    const usable = (reposResult.ok ? reposResult.data?.repos ?? [] : []).filter(
      isUsableForDeveloperAccess
    );
    const usableIds = usable.map((repo) => repo.repoId);
    setUsableRepoIds(usableIds);

    let userId = meResult.ok ? meResult.data?.userId ?? null : null;
    const email = (meResult.ok ? meResult.data?.email : undefined) ?? me?.email;
    if (!userId && email && usersResult.ok && usersResult.data?.users) {
      const match = usersResult.data.users.find(
        (user) => user.email.toLowerCase() === email.toLowerCase()
      );
      userId = match?.id ?? null;
    }
    setSelfUserId(userId);
    if (userId) {
      await refreshSelfGrants(userId, usableIds);
    }
  }, [me?.email, refreshSelfGrants]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleModeChange(mode: OrgRepoAccessMode) {
    setSavingMode(true);
    setError(null);
    setMessage(null);
    const result = await updateRepoAccessMode(mode);
    setSavingMode(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update repository access.");
      return;
    }
    setRepoAccessMode(mode);
    setMessage(
      mode === "all_indexed"
        ? "Everyone in the org can open Usable repos."
        : "Per-user mode on — assign repos to people (including yourself)."
    );
  }

  async function handleGrantSelf() {
    if (!selfUserId || usableRepoIds.length === 0) {
      setError(
        usableRepoIds.length === 0
          ? "Index at least one ready repo first, then grant yourself access."
          : "Could not find your user account to grant access."
      );
      return;
    }
    setGrantingSelf(true);
    setError(null);
    setMessage(null);
    const existing = await fetchUserRepoGrants(selfUserId);
    const merged = new Set(existing.ok && existing.data ? existing.data.repoIds : []);
    for (const id of usableRepoIds) {
      merged.add(id);
    }
    const result = await saveUserRepoGrants(selfUserId, [...merged]);
    setGrantingSelf(false);
    if (!result.ok) {
      setError(result.error ?? "Could not assign repos to you.");
      return;
    }
    setSelfGranted(true);
    setMessage(
      `Assigned ${usableRepoIds.length} ready repo${usableRepoIds.length === 1 ? "" : "s"} to you. Open the extension and Refresh.`
    );
  }

  const perUser = repoAccessMode === "per_user";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">People &amp; access</h3>
        <p className="mt-2 text-sm leading-relaxed text-coop-muted">
          Deep-Indexed repos are ready to open only after people have access. Choose who gets them,
          then assign repos when you use per-user grants. Invite others from Users when you have seats.
          {memberCount !== null
            ? ` ${memberCount} member${memberCount === 1 ? "" : "s"} in your org.`
            : ""}
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-coop-border/50 px-4 py-3 hover:bg-white/[0.03]">
          <input
            type="radio"
            name="onboardingRepoAccess"
            className="mt-1 accent-coop-index"
            checked={!perUser}
            disabled={savingMode}
            onChange={() => void handleModeChange("all_indexed")}
          />
          <span>
            <span className="block text-sm font-medium text-white">Everyone gets Usable repos</span>
            <span className="mt-1 block text-sm text-coop-muted">
              Best default. Anyone in the org can open Deep-Indexed repos in the extension.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-coop-border/50 px-4 py-3 hover:bg-white/[0.03]">
          <input
            type="radio"
            name="onboardingRepoAccess"
            className="mt-1 accent-coop-index"
            checked={perUser}
            disabled={savingMode}
            onChange={() => void handleModeChange("per_user")}
          />
          <span>
            <span className="block text-sm font-medium text-white">Assign per person</span>
            <span className="mt-1 block text-sm text-coop-muted">
              Lock down access. Grant repos when inviting, or on Users → Manage repos — including for
              yourself.
            </span>
          </span>
        </label>
      </div>

      {perUser ? (
        <div className="rounded-md border border-coop-border/60 bg-coop-dark/40 px-4 py-3">
          <p className="text-sm text-coop-muted">
            {usableRepoIds.length > 0 ? (
              <>
                <span className="text-white">{usableRepoIds.length} ready</span> repo
                {usableRepoIds.length === 1 ? "" : "s"} (Deep-Indexed).{" "}
                {selfGranted
                  ? "You already have access — invite others or manage grants on Users."
                  : "Grant yourself access so you can open them in the extension."}
              </>
            ) : (
              <>No Deep-Indexed repos yet — finish Indexing first, then come back to assign people.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!selfGranted ? (
              <button
                type="button"
                className="admin-btn-primary"
                disabled={grantingSelf || usableRepoIds.length === 0 || !selfUserId}
                onClick={() => void handleGrantSelf()}
              >
                {grantingSelf ? "Assigning…" : "Grant myself indexed repos"}
              </button>
            ) : null}
            <Link href="/users" className="admin-btn-secondary">
              Invite &amp; assign on Users
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-coop-border/60 bg-coop-dark/40 px-4 py-3">
          <p className="text-sm text-coop-muted">
            Invite teammates whenever you&apos;re ready — they inherit Usable repos automatically.
          </p>
          <div className="mt-3">
            <Link href="/users" className="admin-btn-secondary">
              Invite users
            </Link>
          </div>
        </div>
      )}

      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
