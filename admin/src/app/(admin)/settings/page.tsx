"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearSession,
  displayOrgName,
  getStoredMe,
  isAdminRole,
  signOutRemote
} from "@/lib/auth";
import { getApiBase } from "@/lib/coopApi";
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

  async function handleSignOut() {
    await signOutRemote();
    clearSession();
    router.replace("/login");
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

      {me?.plan === "enterprise" ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Single sign-on (SSO)</h2>
          <p className="mt-2 text-sm text-coop-muted">
            Enterprise SAML SSO is configured by Coop support during onboarding.
          </p>
          <div className="admin-panel-inset mt-4 text-sm">
            <p className="font-medium text-white/90">Not configured</p>
            <p className="mt-1 text-coop-muted">
              Contact support to enable SAML for your organization.
            </p>
          </div>
        </section>
      ) : null}

      <section className="admin-card">
        <h2 className="admin-section-label">Developer</h2>
        <p className="mt-2 text-sm text-coop-muted">
          Backend API this portal uses (set via <code className="text-xs">COOP_API_BASE</code> at build/runtime).
        </p>
        <code className="mt-3 inline-block max-w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
          {getApiBase()}
        </code>
      </section>
    </div>
  );
}
