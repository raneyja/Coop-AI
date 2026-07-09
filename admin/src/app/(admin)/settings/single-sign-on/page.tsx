"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { fetchOrg } from "@/lib/coopApi";
import { SsoSettingsPanel } from "@/components/SsoSettingsPanel";
import { SettingsSubpage } from "@/components/SettingsSubpage";

export default function SettingsSingleSignOnPage() {
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const [orgPlan, setOrgPlan] = useState<string>(me?.plan ?? "free");

  const load = useCallback(async () => {
    const result = await fetchOrg();
    if (result.ok && result.data) {
      setOrgPlan(result.data.plan);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showSso = isAdmin && orgPlan === "enterprise";

  if (!showSso) {
    return (
      <SettingsSubpage title="Single sign-on">
        <section className="admin-card">
          <p className="text-sm text-coop-muted">
            SAML single sign-on is available on the Enterprise plan for org admins.
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
      title="Single sign-on"
      description="Let your team sign in with your company identity provider (SAML 2.0)."
    >
      <section className="admin-card">
        <SsoSettingsPanel />
      </section>
    </SettingsSubpage>
  );
}
