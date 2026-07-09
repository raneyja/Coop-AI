"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSession, displayOrgName, getStoredMe, isAdminRole, signOutRemote } from "@/lib/auth";
import { PlanBadge } from "@/components/PlanBadge";
import { SettingsRow } from "@/components/SettingsRow";
import { SettingsSubpage } from "@/components/SettingsSubpage";

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

export default function SettingsAccountPage() {
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
    <SettingsSubpage
      title="Account & organization"
      description={
        isAdmin
          ? "Manage your account, organization, and portal preferences."
          : "Your account and portal preferences."
      }
    >
      <section className="admin-card">
        <h2 className="admin-section-label">Account</h2>
        <dl className="mt-4">
          <SettingsRow label="Signed in as">{me?.email ?? "—"}</SettingsRow>
          {me?.firstName || me?.lastName ? (
            <SettingsRow label="Name">
              {[me.firstName, me.lastName].filter(Boolean).join(" ")}
            </SettingsRow>
          ) : null}
          {me?.timezone ? <SettingsRow label="Timezone">{me.timezone}</SettingsRow> : null}
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
            <button
              type="button"
              className="admin-btn-danger !px-3 !py-1.5 text-xs"
              onClick={() => void handleSignOut()}
            >
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
    </SettingsSubpage>
  );
}
