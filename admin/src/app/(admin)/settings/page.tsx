"use client";

import { getStoredMe, displayOrgName } from "@/lib/auth";
import { getApiBase } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";

export default function SettingsPage() {
  const me = getStoredMe();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-coop-muted">Organization configuration.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="admin-card space-y-4">
          <h2 className="admin-section-label">Organization</h2>
          <dl className="space-y-3 text-sm">
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
        </div>

        <div className="admin-card space-y-4">
          <h2 className="admin-section-label">Single sign-on (SSO)</h2>
          <p className="text-sm text-coop-muted">
            Enterprise SAML SSO is configured by Coop support during onboarding.
          </p>
          <div className="rounded-sm border border-coop-border bg-coop-dark px-4 py-3 text-sm">
            <p className="font-medium">Status: Not configured</p>
            <p className="mt-1 text-coop-muted">
              Contact support to enable SAML for your organization. Self-serve SSO setup is planned for a future release.
            </p>
          </div>
        </div>

        <div className="admin-card space-y-3 lg:col-span-2">
          <h2 className="admin-section-label">API connection</h2>
          <p className="text-sm text-coop-muted">
            This portal connects to the Coop backend API configured at build/runtime.
          </p>
          <code className="block rounded-sm border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
            {getApiBase()}
          </code>
        </div>
      </div>
    </div>
  );
}
