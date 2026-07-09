"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { fetchOrg, updateRepoAccessMode, type OrgRepoAccessMode } from "@/lib/coopApi";
import { SettingsSubpage } from "@/components/SettingsSubpage";

export default function SettingsRepositoryAccessPage() {
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const [orgPlan, setOrgPlan] = useState<string>(me?.plan ?? "free");
  const [repoAccessMode, setRepoAccessMode] = useState<OrgRepoAccessMode>("all_indexed");
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const showRepoAccess = isAdmin && (orgPlan === "pro" || orgPlan === "enterprise");

  const load = useCallback(async () => {
    const result = await fetchOrg();
    if (result.ok && result.data) {
      setOrgPlan(result.data.plan);
      if (result.data.repoAccessMode) {
        setRepoAccessMode(result.data.repoAccessMode);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRepoAccessChange(mode: OrgRepoAccessMode) {
    setSavingAccess(true);
    setAccessError(null);
    setAccessMessage(null);
    const result = await updateRepoAccessMode(mode);
    setSavingAccess(false);
    if (!result.ok) {
      setAccessError(result.error ?? "Could not update repository access.");
      return;
    }
    setRepoAccessMode(mode);
    setAccessMessage(
      mode === "all_indexed"
        ? "All team members can access every Deep-Indexed repo."
        : "Assign repository access per user on the Users page."
    );
  }

  if (!showRepoAccess) {
    return (
      <SettingsSubpage title="Repository access">
        <section className="admin-card">
          <p className="text-sm text-coop-muted">
            Repository access settings are available on Pro and Enterprise plans for org admins.
          </p>
          <p className="mt-3">
            <Link href="/settings" className="admin-link">
              ← Back to Settings
            </Link>
          </p>
        </section>
      </SettingsSubpage>
    );
  }

  return (
    <SettingsSubpage
      title="Repository access"
      description="Control which Deep-Indexed repos developers can use in VS Code after your admin selects repos to index."
    >
      <section className="admin-card">
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-coop-border/50 px-4 py-3 hover:bg-white/[0.03]">
            <input
              type="radio"
              name="repoAccessMode"
              className="mt-1 accent-coop-index"
              checked={repoAccessMode === "all_indexed"}
              disabled={savingAccess}
              onChange={() => void handleRepoAccessChange("all_indexed")}
            />
            <span>
              <span className="block text-sm font-medium text-white">All indexed repos</span>
              <span className="mt-1 block text-sm text-coop-muted">
                Every team member automatically sees all Deep-Indexed repos in the extension.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-coop-border/50 px-4 py-3 hover:bg-white/[0.03]">
            <input
              type="radio"
              name="repoAccessMode"
              className="mt-1 accent-coop-index"
              checked={repoAccessMode === "per_user"}
              disabled={savingAccess}
              onChange={() => void handleRepoAccessChange("per_user")}
            />
            <span>
              <span className="block text-sm font-medium text-white">Per-user grants</span>
              <span className="mt-1 block text-sm text-coop-muted">
                Assign repos when inviting users or from each user&apos;s row on the Users page.
              </span>
            </span>
          </label>
        </div>
        {accessMessage ? <p className="mt-3 text-sm text-emerald-300">{accessMessage}</p> : null}
        {accessError ? <p className="mt-3 text-sm text-red-300">{accessError}</p> : null}
      </section>
    </SettingsSubpage>
  );
}
