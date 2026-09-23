"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  clearSession,
  displayOrgName,
  getStoredMe,
  isAdminRole,
  setStoredOrgName,
  signOutRemote
} from "@/lib/auth";
import { fetchMe, fetchOrg, updateOrgName } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";
import { SettingsRow } from "@/components/SettingsRow";
import { SettingsSubpage } from "@/components/SettingsSubpage";
import { useOrgPlan } from "@/hooks/useOrgPlan";

async function loadAdminOrgName(): Promise<string> {
  const result = await fetchOrg();
  return result.ok ? (result.data?.name?.trim() ?? "") : "";
}

async function loadMemberOrgName(): Promise<string> {
  const result = await fetchMe();
  return result.ok ? (result.data?.orgName?.trim() ?? "") : "";
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

export default function SettingsAccountPage() {
  const router = useRouter();
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const { plan, usageTier, seats } = useOrgPlan();
  const usesPassword = me?.authMethod === "password" || me?.sessionProvider === "password";
  const initialOrgName = displayOrgName(me);
  const [orgName, setOrgName] = useState(initialOrgName);
  const [savedOrgName, setSavedOrgName] = useState(initialOrgName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = isAdmin ? await loadAdminOrgName() : await loadMemberOrgName();
      if (cancelled || !next) return;
      setOrgName(next);
      setSavedOrgName(next);
      setStoredOrgName(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function handleOrgNameSubmit(event: FormEvent) {
    event.preventDefault();
    const next = orgName.trim().replace(/\s+/g, " ");
    setNameSaved(false);
    if (!next) {
      setNameError("Enter an organization name.");
      return;
    }
    if (next === savedOrgName) {
      setNameError(null);
      return;
    }
    setSavingName(true);
    setNameError(null);
    const result = await updateOrgName(next);
    setSavingName(false);
    if (!result.ok || !result.data?.name) {
      setNameError(result.error ?? "Could not update the organization name.");
      return;
    }
    setOrgName(result.data.name);
    setSavedOrgName(result.data.name);
    setStoredOrgName(result.data.name);
    setNameSaved(true);
  }

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
          <SettingsRow label="Name">
            {isAdmin ? (
              <form onSubmit={(event) => void handleOrgNameSubmit(event)} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="org-name"
                    type="text"
                    className="admin-input max-w-xs"
                    value={orgName}
                    maxLength={255}
                    autoComplete="organization"
                    aria-label="Organization name"
                    disabled={savingName}
                    onChange={(event) => {
                      setOrgName(event.target.value);
                      setNameError(null);
                      setNameSaved(false);
                    }}
                  />
                  <button
                    type="submit"
                    className="admin-btn-secondary"
                    disabled={savingName || !orgName.trim() || orgName.trim().replace(/\s+/g, " ") === savedOrgName}
                  >
                    {savingName ? "Saving…" : "Save"}
                  </button>
                  {nameSaved ? <span className="text-xs text-coop-muted">Saved</span> : null}
                </div>
                {nameError ? <p className="text-xs text-red-400">{nameError}</p> : null}
                {plan === "enterprise" ? (
                  <p className="text-xs text-coop-muted">SSO sign-in uses this name.</p>
                ) : null}
              </form>
            ) : (
              orgName
            )}
          </SettingsRow>
          <SettingsRow label="Org ID">
            <code className="font-mono text-xs text-coop-muted">{me?.orgId ?? "—"}</code>
          </SettingsRow>
          <SettingsRow label="Plan">
            <PlanBadge plan={plan} usageTier={usageTier} seats={seats} />
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
