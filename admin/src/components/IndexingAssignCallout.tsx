"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchMe,
  fetchUserRepoGrants,
  fetchUsers,
  saveUserRepoGrants,
  type OrgRepoAccessMode,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { getStoredMe } from "@/lib/auth";
import { isUsableForDeveloperAccess } from "@/lib/usableRepos";

type IndexingAssignCalloutProps = {
  repos: OrgRepoRecord[];
  repoAccessMode: OrgRepoAccessMode;
};

/**
 * Gap-only strip: per-user access + developer-ready repos, and the signed-in
 * admin has none of those repos assigned yet.
 */
export function IndexingAssignCallout({
  repos,
  repoAccessMode
}: IndexingAssignCalloutProps): React.ReactElement | null {
  const me = getStoredMe();
  const readyCount = repos.filter(isUsableForDeveloperAccess).length;
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [needsSelfGrant, setNeedsSelfGrant] = useState(false);
  const [granting, setGranting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const readyIds = repos.filter(isUsableForDeveloperAccess).map((repo) => repo.repoId);
    if (repoAccessMode !== "per_user" || readyIds.length === 0) {
      setNeedsSelfGrant(false);
      return;
    }
    const [meResult, usersResult] = await Promise.all([fetchMe(), fetchUsers()]);
    let userId = meResult.ok ? meResult.data?.userId ?? null : null;
    const email = (meResult.ok ? meResult.data?.email : undefined) ?? me?.email;
    if (!userId && email && usersResult.ok && usersResult.data?.users) {
      const match = usersResult.data.users.find(
        (user) => user.email.toLowerCase() === email.toLowerCase()
      );
      userId = match?.id ?? null;
    }
    setSelfUserId(userId);
    if (!userId) {
      setNeedsSelfGrant(true);
      return;
    }
    const grants = await fetchUserRepoGrants(userId);
    if (!grants.ok || !grants.data) {
      setNeedsSelfGrant(true);
      return;
    }
    const granted = new Set(grants.data.repoIds);
    setNeedsSelfGrant(!readyIds.some((id) => granted.has(id)));
  }, [me?.email, repoAccessMode, repos]);

  useEffect(() => {
    void check();
  }, [check]);

  async function handleGrantSelf() {
    const readyIds = repos.filter(isUsableForDeveloperAccess).map((repo) => repo.repoId);
    if (!selfUserId || readyIds.length === 0) {
      setError("Could not assign repos — refresh and try again from Users.");
      return;
    }
    setGranting(true);
    setError(null);
    setMessage(null);
    const existing = await fetchUserRepoGrants(selfUserId);
    const merged = new Set(existing.ok && existing.data ? existing.data.repoIds : []);
    for (const id of readyIds) {
      merged.add(id);
    }
    const result = await saveUserRepoGrants(selfUserId, [...merged]);
    setGranting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not assign repos.");
      return;
    }
    setNeedsSelfGrant(false);
    setMessage("Assigned. In the extension, open Remote workspace and click Refresh.");
  }

  if (repoAccessMode !== "per_user" || readyCount === 0 || !needsSelfGrant) {
    if (message) {
      return <p className="text-sm text-emerald-300">{message}</p>;
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coop-border bg-coop-dark/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-white">
          {readyCount} ready repo{readyCount === 1 ? "" : "s"} — assign who can open them
        </p>
        <p className="mt-1 text-sm text-coop-muted">
          Per-user access is on. Indexing alone does not give you (or anyone) extension access.
        </p>
        {error ? <p className="mt-1 text-sm text-red-300">{error}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          className="admin-btn-primary"
          disabled={granting || !selfUserId}
          onClick={() => void handleGrantSelf()}
        >
          {granting ? "Assigning…" : "Grant myself"}
        </button>
        <Link href="/users" className="admin-btn-secondary">
          Users
        </Link>
      </div>
    </div>
  );
}
