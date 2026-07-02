"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearSession,
  displayOrgName,
  getStoredMe,
  isAdminRole,
  signOutRemote
} from "@/lib/auth";
import { fetchOrg, getApiBase, updateRepoAccessMode, type OrgRepoAccessMode } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-coop-border/30 py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-x-6">
      <dt className="text-sm text-coop-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-white">{children}</dd>
    </div>
  );
}

function signInMethodLabel(me: ReturnType<typeof getStoredMe>): string {
  switch (me?.authMethod) {
    case "password":
      return "Email and password";
    case "google_oauth":
      return "Google";
    case "sso_session":
      return "SSO";
    case "api_key":
      return "Automation API key";
    default:
      return "Coop account";
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const usesPassword = me?.authMethod === "password" || me?.sessionProvider === "password";
  const [repoAccessMode, setRepoAccessMode] = useState<OrgRepoAccessMode>("all_indexed");
  const [orgPlan, setOrgPlan] = useState<string>(me?.plan ?? "free");
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const showRepoAccess = orgPlan === "pro" || orgPlan === "enterprise";

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

  async function handleSignOut() {
    await signOutRemote();
    clearSession();
    router.replace("/login");
  }

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

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="admin-page-title">Settings</h1>
        <p className="mt-1 text-sm text-coop-muted">Manage your account, organization, and portal preferences.</p>
      </div>

      <section className="admin-card">
        <h2 className="admin-section-label">Sign-in &amp; access</h2>
        <p className="mt-2 text-sm text-coop-muted">
          Sign in with your Coop account (email and password or Google). Your session is stored in this browser and
          cleared when you sign out.
        </p>
        <dl className="mt-4">
          <SettingsRow label="Signed in as">{me?.email ?? "—"}</SettingsRow>
          <SettingsRow label="Sign-in method">{signInMethodLabel(me)}</SettingsRow>
          <SettingsRow label="Role">{me?.role ?? "Member"}</SettingsRow>
          {usesPassword ? (
            <SettingsRow label="Password">
              <Link href="/forgot-password" className="admin-link">
                Change password →
              </Link>
            </SettingsRow>
          ) : null}
          <SettingsRow label="API keys">
            {isAdmin ? (
              <Link href="/api-keys" className="admin-link">
                Manage automation keys →
              </Link>
            ) : (
              <span className="text-coop-muted">Contact an org admin to rotate keys.</span>
            )}
          </SettingsRow>
          <SettingsRow label="Session">
            <button type="button" className="admin-btn-danger !px-3 !py-1.5 text-xs" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </SettingsRow>
        </dl>
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Organization</h2>
        <dl className="mt-4">
          <SettingsRow label="Name">{displayOrgName(me)}</SettingsRow>
          <SettingsRow label="Org ID">
            <code className="font-mono text-xs text-coop-muted">{me?.orgId ?? "—"}</code>
          </SettingsRow>
          <SettingsRow label="Plan">
            <PlanBadge plan={me?.plan ?? "free"} />
          </SettingsRow>
          {isAdmin ? (
            <SettingsRow label="Billing">
              <Link href="/billing" className="admin-link">
                View plan &amp; billing →
              </Link>
            </SettingsRow>
          ) : null}
        </dl>
      </section>

      {showRepoAccess ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Repository access</h2>
          <p className="mt-2 text-sm text-coop-muted">
            Control which Deep-Indexed repos developers can use in VS Code after your admin selects repos to index.
          </p>
          <div className="mt-4 space-y-3">
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
      ) : null}

      {me?.plan === "enterprise" ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Single sign-on (SSO)</h2>
          <p className="mt-2 text-sm text-coop-muted">Enterprise SAML SSO is configured by Coop support during onboarding.</p>
          <div className="admin-panel-inset mt-4 text-sm">
            <p className="font-medium text-white/90">Not configured</p>
            <p className="mt-1 text-coop-muted">
              Contact support to enable SAML for your organization.
            </p>
          </div>
        </section>
      ) : null}

      <section className="admin-card">
        <h2 className="admin-section-label">API connection</h2>
        <p className="mt-3 text-sm text-coop-muted">This portal connects to the Coop backend API configured at build/runtime.</p>
        <code className="mt-3 block rounded-md border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
          {getApiBase()}
        </code>
      </section>
    </div>
  );
}
