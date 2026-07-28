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
import { isFullyUsable } from "@/lib/indexingProgress";

type IndexingAssignCalloutProps = {
  repos: OrgRepoRecord[];
  repoAccessMode: OrgRepoAccessMode;
};

/**
 * Gap-only strip: per-user access + Usable repos, and the signed-in admin
 * has none of those repos assigned yet.
 */
export function IndexingAssignCallout({
  repos,
  repoAccessMode
}: IndexingAssignCalloutProps): React.ReactElement | null {
  const me = getStoredMe();
  const usableCount = repos.filter(isFullyUsable).length;
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [needsSelfGrant, setNeedsSelfGrant] = useState(false);
  const [granting, setGranting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const usableIds = repos.filter(isFullyUsable).map((repo) => repo.repoId);
    if (repoAccessMode !== "per_user" || usableIds.length === 0) {
      setNeedsSelfGrant(false);
      return;
    }
    const [meResult, usersResult] = await Promise.all([fetchMe(), fetchUsers()]);
    let userId = meResult.ok ? meResult.data?.userId ?? null : null;
    if (!userId && me?.email && usersResult.ok && usersResult.data?.users) {
      const match = usersResult.data.users.find(
        (user) => user.email.toLowerCase() === me.email!.toLowerCase()
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
    setNeedsSelfGrant(!usableIds.some((id) => granted.has(id)));
  }, [me?.email, repoAccessMode, repos]);

  useEffect(() => {
    void check();
  }, [check]);

  async function handleGrantSelf() {
    const usableIds = repos.filter(isFullyUsable).map((repo) => repo.repoId);
    if (!selfUserId || usableIds.length === 0) {
      setError("Could not assign repos — refresh and try again from Users.");
      return;
    }
    setGranting(true);
    setError(null);
    setMessage(null);
    const existing = await fetchUserRepoGrants(selfUserId);
    const merged = new Set(existing.ok && existing.data ? existing.data.repoIds : []);
    for (const id of usableIds) {
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

  if (repoAccessMode !== "per_user" || usableCount === 0 || !needsSelfGrant) {
    if (message) {
      return <p className="text-sm text-emerald-300">{message}</p>;
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coop-border bg-coop-dark/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-white">
          {usableCount} Usable repo{usableCount === 1 ? "" : "s"} — assign who can open them
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
