"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyticsRangeParams,
  exportAnalyticsCsv,
  fetchAnalyticsChat,
  fetchAnalyticsCompletions,
  fetchAnalyticsOverview,
  type AnalyticsCompletions,
  fetchIntegrations,
  fetchOrgRepos,
  fetchUsers,
  type AnalyticsChat,
  type AnalyticsOverview,
  type AnalyticsRange,
  type AdminUser,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { INTEGRATIONS, type IntegrationStatus } from "@/lib/integrations";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { IntegrationStatusList } from "@/components/IntegrationStatusList";
import { UnavailableBanner } from "@/components/UnavailableBanner";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat & Actions" },
  { id: "lightning", label: "Lightning" },
  { id: "completions", label: "Completions" },
  { id: "integrations", label: "Integrations" },
  { id: "users", label: "Users" }
] as const;

type TabId = (typeof TABS)[number]["id"];

const CHAT_MINUTES_SAVED = 5;
const QUICK_ACTION_MINUTES_SAVED = 10;

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatQuickActionLabel(eventType: string): string {
  const suffix = eventType.replace(/^quick_action\./, "");
  return suffix.replace(/_/g, " ");
}

function EventsByDayTable({ rows, emptyLabel }: { rows: Array<{ day: string; count: number }>; emptyLabel: string }) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-coop-muted">{emptyLabel}</div>
    );
  }

  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="admin-card--table">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Events</th>
            <th className="w-1/2">Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td className="whitespace-nowrap text-xs text-coop-muted">
                {new Date(`${row.day}T00:00:00Z`).toLocaleDateString()}
              </td>
              <td className="tabular-nums">{row.count}</td>
              <td>
                <div className="h-2 rounded-sm bg-coop-dark">
                  <div
                    className="h-2 rounded-sm bg-coop-index/70"
                    style={{ width: `${Math.max(4, (row.count / maxCount) * 100)}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaceholderCallout({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin-panel-inset text-sm text-coop-muted">
      <p className="font-medium text-white/90">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [chat, setChat] = useState<AnalyticsChat | null>(null);
  const [completions, setCompletions] = useState<AnalyticsCompletions | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orgRepos, setOrgRepos] = useState<OrgRepoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { from, to } = useMemo(() => analyticsRangeParams(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [overviewResult, chatResult, completionsResult, integrationsResult, usersResult, reposResult] =
      await Promise.all([
        fetchAnalyticsOverview(from, to),
        fetchAnalyticsChat(from, to),
        fetchAnalyticsCompletions(from, to),
        fetchIntegrations(),
        fetchUsers(),
        fetchOrgRepos()
      ]);

    if (integrationsResult.ok) {
      setIntegrations(integrationsResult.data ?? []);
    }

    if (usersResult.ok) {
      setUsers(usersResult.data?.users ?? []);
    }

    if (reposResult.ok) {
      setOrgRepos(reposResult.data?.repos ?? []);
    }

    setLoading(false);

    if (overviewResult.unavailable || chatResult.unavailable || completionsResult.unavailable) {
      setUnavailable(true);
      setOverview(null);
      setChat(null);
      setCompletions(null);
      return;
    }

    setUnavailable(false);

    if (!overviewResult.ok) {
      setError(overviewResult.error ?? "Failed to load analytics overview.");
      setOverview(null);
    } else {
      setOverview(overviewResult.data ?? null);
    }

    if (!chatResult.ok) {
      setError(chatResult.error ?? "Failed to load chat analytics.");
      setChat(null);
    } else {
      setChat(chatResult.data ?? null);
    }

    if (!completionsResult.ok) {
      setError(completionsResult.error ?? "Failed to load completion analytics.");
      setCompletions(null);
    } else {
      setCompletions(completionsResult.data ?? null);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const quickActionTotal = useMemo(
    () => (chat?.quickActions ?? []).reduce((sum, row) => sum + row.count, 0),
    [chat]
  );

  const estimatedHoursSaved = useMemo(() => {
    const chatMessages = chat?.chatMessages ?? 0;
    const minutes = chatMessages * CHAT_MINUTES_SAVED + quickActionTotal * QUICK_ACTION_MINUTES_SAVED;
    return (minutes / 60).toFixed(1);
  }, [chat, quickActionTotal]);

  const connectedIntegrations = integrations.filter((item) => item.installed).length;

  const lightningRepos = useMemo(
    () => orgRepos.filter((repo) => repo.lightningEnabled !== false),
    [orgRepos]
  );

  const indexedRepoCount = useMemo(
    () => lightningRepos.filter((repo) => repo.indexStatus === "ready").length,
    [lightningRepos]
  );

  const userActivityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of chat?.topUsers ?? []) {
      map.set(row.principal, row.count);
    }
    return map;
  }, [chat]);

  async function handleExport() {
    setExporting(true);
    setError(null);
    const result = await exportAnalyticsCsv(from, to);
    setExporting(false);
    if (!result.ok) {
      setError(result.error ?? "Export failed.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Analytics</h1>
          <p className="mt-1 text-sm text-coop-muted">
            Usage, engagement, and impact across chat, Lightning, and integrations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-sm border border-coop-border">
            {(["7d", "30d", "90d"] as AnalyticsRange[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`admin-btn px-3 py-1.5 text-xs ${
                  range === option
                    ? "bg-coop-index text-coop-dark"
                    : "bg-transparent text-coop-muted hover:bg-white/[0.03] hover:text-white"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="admin-btn-secondary"
            onClick={() => void handleExport()}
            disabled={exporting || unavailable}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {unavailable && (
        <UnavailableBanner message="Usage analytics API is unavailable. Ensure migrations are applied and the API is running with usage tracking enabled." />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-1 border-b border-coop-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`admin-btn border-b-2 px-4 py-2 text-sm ${
              activeTab === tab.id
                ? "border-coop-index text-white"
                : "border-transparent text-coop-muted hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <AdminStatRow>
            <AdminStat
              label="Total users"
              value={loading ? "—" : (overview?.totalUsers ?? 0)}
              hint={`${overview?.activeUsers ?? 0} active`}
            />
            <AdminStat label="DAU" value={loading ? "—" : (overview?.dau ?? 0)} hint="Last 24 hours" />
            <AdminStat label="MAU" value={loading ? "—" : (overview?.mau ?? 0)} hint={`Selected ${range}`} />
            <AdminStat
              label="Seat utilization"
              value={loading ? "—" : formatPercent(overview?.seatUtilization ?? 0)}
              hint={
                overview
                  ? `${overview.activeUsers} of ${overview.seats} seats`
                  : undefined
              }
            />
          </AdminStatRow>

          <AdminStatRow>
            <AdminStat
              label="Total events"
              value={loading ? "—" : (overview?.totalEvents ?? 0)}
              hint={`Selected ${range}`}
            />
            <AdminStat
              label="Est. hours saved"
              value={loading ? "—" : estimatedHoursSaved}
              hint={`${CHAT_MINUTES_SAVED} min/chat + ${QUICK_ACTION_MINUTES_SAVED} min/quick action`}
            />
          </AdminStatRow>

          <section>
            <h2 className="admin-section-label mb-4">Event volume by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <EventsByDayTable
                rows={overview?.eventsByDay ?? []}
                emptyLabel="No usage events yet. Activity will appear here once your team uses Coop."
              />
            )}
          </section>
        </div>
      )}

      {activeTab === "chat" && (
        <div className="space-y-6">
          <AdminStatRow>
            <AdminStat
              label="Chat messages"
              value={loading ? "—" : (chat?.chatMessages ?? 0)}
              hint={`Selected ${range}`}
            />
            <AdminStat
              label="Quick actions"
              value={loading ? "—" : quickActionTotal}
              hint={`Selected ${range}`}
            />
          </AdminStatRow>

          <section>
            <h2 className="admin-section-label mb-4">Quick actions by type</h2>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-coop-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : (chat?.quickActions ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-coop-muted">
                        No quick action events yet.
                      </td>
                    </tr>
                  ) : (
                    chat?.quickActions.map((row) => (
                      <tr key={row.eventType}>
                        <td className="capitalize">{formatQuickActionLabel(row.eventType)}</td>
                        <td className="tabular-nums">{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="admin-section-label mb-4">Chat activity by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <EventsByDayTable
                rows={chat?.eventsByDay ?? []}
                emptyLabel="No chat activity recorded for this period."
              />
            )}
          </section>

          <section>
            <h2 className="admin-section-label mb-4">Top active users</h2>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Principal</th>
                    <th>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-coop-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : (chat?.topUsers ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-coop-muted">
                        No user activity yet.
                      </td>
                    </tr>
                  ) : (
                    chat?.topUsers.map((row) => (
                      <tr key={row.principal}>
                        <td className="font-mono text-xs">{row.principal}</td>
                        <td className="tabular-nums">{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeTab === "lightning" && (
        <div className="space-y-6">
          <AdminStatRow>
            <AdminStat
              label="Total usage events"
              value={loading ? "—" : (overview?.totalEvents ?? 0)}
              hint="Includes lightning.search, chat.message, and other events"
            />
            <AdminStat
              label="Indexed repos"
              value={loading ? "—" : `${indexedRepoCount} ready`}
              hint={
                lightningRepos.length > 0
                  ? `${lightningRepos.length} Lightning-enabled repo(s)`
                  : "Enable Lightning on repos in Collections"
              }
            />
          </AdminStatRow>

          <section>
            <h2 className="admin-section-label mb-4">Repo index status</h2>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Status</th>
                    <th>Last indexed</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-coop-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : lightningRepos.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-coop-muted">
                        No Lightning-enabled repos yet.
                      </td>
                    </tr>
                  ) : (
                    lightningRepos.map((repo) => (
                      <tr key={repo.repoId}>
                        <td className="font-mono text-xs">{repo.repoId}</td>
                        <td className="capitalize">{repo.indexStatus ?? "unknown"}</td>
                        <td className="text-xs text-coop-muted">
                          {repo.lastIndexedAt
                            ? new Date(repo.lastIndexedAt).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeTab === "completions" && (
        <div className="space-y-6">
          {!loading && completions && completions.suggested === 0 && completions.accepted === 0 ? (
            <PlaceholderCallout
              title="No completion events yet"
              body="Counts appear when Coop autocomplete is enabled: ghost-text shown (completion.suggested), Tab accept (completion.accepted), and server inline requests (completion.requested). Cursor/Copilot inline suggestions do not count here."
            />
          ) : null}
          <AdminStatRow>
            <AdminStat
              label="Suggested"
              value={loading ? "—" : (completions?.suggested ?? 0)}
              hint="Shown in editor (completion.suggested)"
            />
            <AdminStat
              label="Requested"
              value={loading ? "—" : (completions?.requested ?? 0)}
              hint="Server inline LLM calls (completion.requested)"
            />
            <AdminStat
              label="Accepted"
              value={loading ? "—" : (completions?.accepted ?? 0)}
              hint="completion.accepted events"
            />
            <AdminStat
              label="CAR"
              value={
                loading
                  ? "—"
                  : completions?.acceptanceRate != null
                    ? formatPercent(completions.acceptanceRate)
                    : "—"
              }
              hint="Accepted ÷ suggested (shown)"
            />
          </AdminStatRow>
          <AdminStatRow>
            <AdminStat
              label="Server p50"
              value={
                loading
                  ? "—"
                  : completions?.serverLatencyP50Ms != null
                    ? `${Math.round(completions.serverLatencyP50Ms)}ms`
                    : "—"
              }
              hint="completion.requested latencyMs"
            />
            <AdminStat
              label="Server p95"
              value={
                loading
                  ? "—"
                  : completions?.serverLatencyP95Ms != null
                    ? `${Math.round(completions.serverLatencyP95Ms)}ms`
                    : "—"
              }
              hint={`${completions?.serverLatencySamples ?? 0} samples`}
            />
            <AdminStat
              label="Client p50"
              value={
                loading
                  ? "—"
                  : completions?.clientLatencyP50Ms != null
                    ? `${Math.round(completions.clientLatencyP50Ms)}ms`
                    : "—"
              }
              hint="completion.performance batches"
            />
            <AdminStat
              label="Client p95"
              value={
                loading
                  ? "—"
                  : completions?.clientLatencyP95Ms != null
                    ? `${Math.round(completions.clientLatencyP95Ms)}ms`
                    : "—"
              }
              hint={`${completions?.clientLatencySamples ?? 0} batches`}
            />
          </AdminStatRow>
          <section>
            <h2 className="admin-section-label mb-4">Completion volume by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <EventsByDayTable
                rows={completions?.eventsByDay ?? []}
                emptyLabel="No completion usage events in this range."
              />
            )}
          </section>
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="space-y-6">
          <AdminStatRow>
            <AdminStat
              label="Connected integrations"
              value={loading ? "—" : connectedIntegrations}
              hint={`of ${INTEGRATIONS.length} available`}
            />
            <AdminStat label="Integration tests" value="—" hint="Test events not tracked yet" />
          </AdminStatRow>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="admin-section-label">Providers</h2>
              <Link href="/integrations" className="admin-link text-sm">
                Manage integrations →
              </Link>
            </div>
            <IntegrationStatusList integrations={integrations} loading={loading} />
          </section>
        </div>
      )}

      {activeTab === "users" && (
        <div className="space-y-6">
          {!loading && users.length === 0 ? (
            <PlaceholderCallout
              title="No org members yet"
              body="This org was set up with an API key only — that does not create a user row. Invite teammates on the Users page to manage seats and see per-user activity. Extension usage via API key is tracked as apikey:… in usage events, not in this table."
            />
          ) : null}
          <AdminStatRow>
            <AdminStat
              label="Active users"
              value={loading ? "—" : (overview?.activeUsers ?? 0)}
              hint={`${overview?.totalUsers ?? 0} total members`}
            />
            <AdminStat
              label="Seat utilization"
              value={loading ? "—" : formatPercent(overview?.seatUtilization ?? 0)}
              hint={
                overview
                  ? `${overview.activeUsers} of ${overview.seats} seats used`
                  : undefined
              }
            />
          </AdminStatRow>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="admin-section-label">User activity</h2>
              <Link href="/users" className="admin-link text-sm">
                Manage users →
              </Link>
            </div>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Events ({range})</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-coop-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-coop-muted">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.email}</td>
                        <td className="capitalize">{user.role}</td>
                        <td className="capitalize">{user.status}</td>
                        <td className="tabular-nums">
                          {userActivityMap.get(user.email) ??
                            userActivityMap.get(user.id) ??
                            0}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
