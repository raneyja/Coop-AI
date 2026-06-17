"use client";

import { getStoredMe, displayOrgName } from "@/lib/auth";
import { getApiBase } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";

export default function SettingsPage() {
  const me = getStoredMe();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Settings</h1>
        <p className="mt-1 text-sm text-coop-muted">Organization configuration.</p>
      </div>

      <div className="space-y-8">
        <section className="admin-card">
          <h2 className="admin-section-label">Organization</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-coop-muted">Name</dt>
              <dd className="mt-0.5 font-medium">{displayOrgName(me)}</dd>
            </div>
            <div>
              <dt className="text-coop-muted">Org ID</dt>
              <dd className="mt-0.5 font-mono text-xs">{me?.orgId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-coop-muted">Plan</dt>
              <dd className="mt-1">
                <PlanBadge plan={me?.plan ?? "free"} />
              </dd>
            </div>
          </dl>
        </section>

        <section className="admin-card">
          <h2 className="admin-section-label">Single sign-on (SSO)</h2>
          <p className="mt-3 text-sm text-coop-muted">
            Enterprise SAML SSO is configured by Coop support during onboarding.
          </p>
          <div className="admin-panel-inset mt-4 text-sm">
            <p className="font-medium text-white/90">Status: Not configured</p>
            <p className="mt-1 text-coop-muted">
              Contact support to enable SAML for your organization. Self-serve SSO setup is planned for a future release.
            </p>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-section-label">API connection</h2>
          <p className="mt-3 text-sm text-coop-muted">
            This portal connects to the Coop backend API configured at build/runtime.
          </p>
          <code className="mt-3 block rounded-md border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
            {getApiBase()}
          </code>
        </section>
      </div>
    </div>
  );
}
