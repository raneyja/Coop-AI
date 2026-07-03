"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import { fetchIntegrations, fetchMeWorkspaceRepos, type WorkspaceRepo } from "@/lib/coopApi";
import { displayName } from "@/lib/timezones";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { PlanBadge } from "@/components/PlanBadge";
import { IntegrationStatusList } from "@/components/IntegrationStatusList";

const EXTENSION_URL = "https://marketplace.visualstudio.com/search?term=coop%20ai&target=VSCode";

function repoLabel(repo: WorkspaceRepo): string {
  return `${repo.owner}/${repo.name}`;
}

export function MemberDashboard() {
  const me = getStoredMe();
  const [repos, setRepos] = useState<WorkspaceRepo[]>([]);
  const [adminControlled, setAdminControlled] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [reposResult, integrationsResult] = await Promise.all([
      fetchMeWorkspaceRepos(),
      fetchIntegrations()
    ]);
    setLoading(false);

    if (reposResult.ok && reposResult.data) {
      setRepos(reposResult.data.repos ?? []);
      setAdminControlled(Boolean(reposResult.data.adminControlled));
    } else if (!reposResult.ok) {
      setError(reposResult.error ?? "Failed to load your repositories.");
    }

    if (integrationsResult.ok) {
      setIntegrations(integrationsResult.data ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = integrations.filter((integration) => integration.installed).length;
  const greeting = displayName(me?.firstName, me?.lastName, me?.email);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Welcome, {greeting}</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Your workspace in {displayOrgName(me)} — repositories, tools, and extension setup.
        </p>
      </div>

      <AdminStatRow>
        <div className="admin-stat">
          <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">Organization</p>
          <p className="mt-1 text-lg font-semibold text-white">{displayOrgName(me)}</p>
          <div className="mt-2">
            <PlanBadge plan={me?.plan ?? "free"} />
          </div>
        </div>
        <AdminStat
          label="Assigned repositories"
          value={loading ? "—" : repos.length}
          hint={adminControlled ? "Set by your admin" : "Your workspace selection"}
        />
        <AdminStat
          label="Org integrations"
          value={loading ? "—" : connectedCount}
          hint={`of ${INTEGRATIONS.length} available`}
        />
      </AdminStatRow>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="admin-section-label">Your repositories</h2>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <div className="admin-card--table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Index status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-coop-muted">
                    Loading…
                  </td>
                </tr>
              ) : repos.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-coop-muted">
                    No repositories assigned yet. Ask your admin to grant access from Users → Repository
                    access.
                  </td>
                </tr>
              ) : (
                repos.map((repo) => (
                  <tr key={repo.repoId}>
                    <td className="font-mono text-sm">{repoLabel(repo)}</td>
                    <td className="text-sm capitalize text-coop-muted">{repo.indexStatus ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {adminControlled ? (
          <p className="text-xs text-coop-muted">
            Repository access is managed by your organization admin. Contact them to request additional repos.
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="admin-section-label">Organization tools</h2>
          <Link href="/integrations" className="admin-link inline-flex items-center gap-1 text-sm">
            View integrations
            <span aria-hidden>↗</span>
          </Link>
        </div>
        <p className="text-sm text-coop-muted">
          Your admin connects org-wide tools (GitHub, Slack, Jira, etc.). Link your personal accounts in the
          VS Code extension under Settings → Tools after you install.
        </p>
        <IntegrationStatusList integrations={integrations} loading={loading} />
      </section>

      <section className="rounded-md border border-coop-border bg-coop-surface/40 p-5">
        <h2 className="text-base font-semibold text-white">Install the VS Code extension</h2>
        <p className="mt-2 text-sm text-coop-muted">
          Download Coop AI from the marketplace, then sign in with the same email and password you used here.
          Your assigned repositories and org context load automatically.
        </p>
        <a
          href={EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-btn-primary mt-4 inline-block"
        >
          Open VS Code Marketplace
        </a>
      </section>
    </div>
  );
}
