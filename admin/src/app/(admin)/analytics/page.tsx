"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyticsRangeParams,
  exportAnalyticsCsv,
  fetchAnalyticsChat,
  fetchAnalyticsCompletions,
  fetchAnalyticsOverview,
  fetchAnalyticsUsers,
  fetchUsers,
  type AnalyticsChat,
  type AnalyticsCompletions,
  type AnalyticsOverview,
  type AnalyticsRange,
  type AnalyticsUsers,
  type AdminUser
} from "@/lib/coopApi";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { AnalyticsBarChart, AnalyticsLineChart } from "@/components/analytics";
import { quickActionLabelFromEventType } from "@/lib/quickActionLabels";
import { UnavailableBanner } from "@/components/UnavailableBanner";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat & Actions" },
  { id: "completions", label: "Completions" },
  { id: "users", label: "Users" }
] as const;

type TabId = (typeof TABS)[number]["id"];

const MINUTES_SAVED_PER_ACTION = 5;

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function PlaceholderCallout({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin-panel-inset text-sm text-coop-muted">
      <p className="font-medium text-white/90">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function activityMixBars(
  chat: AnalyticsChat | null,
  completions: AnalyticsCompletions | null
): Array<{ label: string; value: number }> {
  const quickActions = (chat?.quickActions ?? []).reduce((sum, row) => sum + row.count, 0);
  return [
    { label: "Chat", value: chat?.chatMessages ?? 0 },
    {
      label: "Completions",
      value:
        (completions?.suggested ?? 0) +
        (completions?.accepted ?? 0) +
        (completions?.requested ?? 0)
    },
    { label: "Quick actions", value: quickActions },
    { label: "Edits", value: chat?.editRequested ?? 0 }
  ].filter((row) => row.value > 0);
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [chat, setChat] = useState<AnalyticsChat | null>(null);
  const [completions, setCompletions] = useState<AnalyticsCompletions | null>(null);
  const [analyticsUsers, setAnalyticsUsers] = useState<AnalyticsUsers | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { from, to } = useMemo(() => analyticsRangeParams(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      overviewResult,
      chatResult,
      completionsResult,
      analyticsUsersResult,
      usersResult
    ] = await Promise.all([
      fetchAnalyticsOverview(from, to),
      fetchAnalyticsChat(from, to),
      fetchAnalyticsCompletions(from, to),
      fetchAnalyticsUsers(from, to),
      fetchUsers()
    ]);

    if (usersResult.ok) {
      setUsers(usersResult.data?.users ?? []);
    }

    if (analyticsUsersResult.ok && !analyticsUsersResult.unavailable) {
      setAnalyticsUsers(analyticsUsersResult.data ?? null);
    } else {
      setAnalyticsUsers(null);
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
    const actions = (chat?.chatMessages ?? 0) + quickActionTotal;
    return ((actions * MINUTES_SAVED_PER_ACTION) / 60).toFixed(1);
  }, [chat, quickActionTotal]);

  const userActivityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of chat?.topUsers ?? []) {
      map.set(row.principal, row.count);
    }
    return map;
  }, [chat]);

  const perUserCarMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of completions?.topUsersByCar ?? []) {
      if (row.acceptanceRate === undefined) continue;
      map.set(row.principal, row.acceptanceRate);
    }
    for (const row of chat?.topUsers ?? []) {
      if (row.acceptanceRate === undefined) continue;
      map.set(row.principal, row.acceptanceRate);
    }
    for (const row of analyticsUsers?.users ?? []) {
      if (row.acceptanceRate === undefined) continue;
      map.set(row.principal, row.acceptanceRate);
      if (row.email) map.set(row.email, row.acceptanceRate);
    }
    return map;
  }, [completions, chat, analyticsUsers]);

  const hasPerUserCar = perUserCarMap.size > 0;

  function eventsForUser(user: AdminUser): number {
    return (
      userActivityMap.get(user.email) ??
      userActivityMap.get(`user:${user.id}`) ??
      userActivityMap.get(user.id) ??
      0
    );
  }

  function carForUser(user: AdminUser): number | null | undefined {
    if (perUserCarMap.has(user.email)) return perUserCarMap.get(user.email);
    if (perUserCarMap.has(`user:${user.id}`)) return perUserCarMap.get(`user:${user.id}`);
    if (perUserCarMap.has(user.id)) return perUserCarMap.get(user.id);
    return undefined;
  }

  const orgCar = useMemo(() => {
    if (overview?.acceptanceRate != null) return overview.acceptanceRate;
    if (completions?.acceptanceRate != null) return completions.acceptanceRate;
    return null;
  }, [overview, completions]);

  const activityMix = useMemo(
    () => activityMixBars(chat, completions),
    [chat, completions]
  );

  const inactiveCount = useMemo(() => {
    if (typeof analyticsUsers?.inactiveSeatCount === "number") {
      return analyticsUsers.inactiveSeatCount;
    }
    if (typeof overview?.inactiveSeatCount === "number") {
      return overview.inactiveSeatCount;
    }
    if (typeof analyticsUsers?.inactiveSeats === "number") {
      return analyticsUsers.inactiveSeats;
    }
    if (typeof overview?.inactiveSeats === "number") {
      return overview.inactiveSeats;
    }
    if (Array.isArray(overview?.inactiveUsers)) {
      return overview.inactiveUsers.length;
    }
    if (typeof overview?.inactiveUsers === "number") {
      return overview.inactiveUsers;
    }
    if (Array.isArray(analyticsUsers?.inactiveUsers)) {
      return analyticsUsers.inactiveUsers.length;
    }
    if (typeof analyticsUsers?.inactiveUsers === "number") {
      return analyticsUsers.inactiveUsers;
    }
    // Fallback: members with 0 events in chat.topUsers map for the selected range
    if (users.length === 0) return null;
    return users.filter((user) => {
      if (user.status === "deactivated") return false;
      return eventsForUser(user) === 0;
    }).length;
  }, [analyticsUsers, overview, users, userActivityMap]);

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
            Organization-wide adoption, AI usage, and completion quality. Switch to My Analytics for
            your personal activity.
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
              label="Org CAR"
              value={
                loading
                  ? "—"
                  : orgCar != null
                    ? formatPercent(orgCar)
                    : "—"
              }
              hint={
                orgCar != null
                  ? "Accepted ÷ suggested (completions)"
                  : "Appears when completion events exist"
              }
            />
            <AdminStat
              label="Est. hours saved"
              value={loading ? "—" : estimatedHoursSaved}
              hint={`${MINUTES_SAVED_PER_ACTION} min per chat message or quick action`}
            />
          </AdminStatRow>

          <section className="admin-card p-4">
            <h2 className="admin-section-label mb-3">Event volume by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <AnalyticsLineChart
                data={overview?.eventsByDay ?? []}
                emptyLabel="No usage events yet. Activity will appear here once your team uses Coop."
              />
            )}
          </section>

          <section className="admin-card p-4">
            <h2 className="admin-section-label mb-3">Activity mix</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <AnalyticsBarChart
                data={activityMix}
                orientation="horizontal"
                emptyLabel="No product activity in this range yet."
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
            <AdminStat
              label="Edit requests"
              value={loading ? "—" : (chat?.editRequested ?? 0)}
              hint="edit.requested (/edit, /patch)"
            />
            <AdminStat
              label="Patches applied"
              value={loading ? "—" : (chat?.editPatchApplied ?? 0)}
              hint="edit.patch_applied"
            />
            <AdminStat
              label="Patches rejected"
              value={loading ? "—" : (chat?.editPatchRejected ?? 0)}
              hint="edit.patch_rejected"
            />
            <AdminStat
              label="Edit apply rate"
              value={
                loading
                  ? "—"
                  : chat?.editApplyRate != null
                    ? `${Math.round(chat.editApplyRate * 100)}%`
                    : "—"
              }
              hint="applied / requested"
            />
          </AdminStatRow>

          <section className="admin-card p-4">
            <h2 className="admin-section-label mb-3">Chat activity by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <AnalyticsLineChart
                data={chat?.eventsByDay ?? []}
                emptyLabel="No chat activity recorded for this period."
              />
            )}
          </section>

          <section className="admin-card p-4">
            <h2 className="admin-section-label mb-3">Quick actions by type</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <AnalyticsBarChart
                data={(chat?.quickActions ?? []).map((row) => ({
                  label: quickActionLabelFromEventType(row.eventType),
                  value: row.count
                }))}
                orientation="horizontal"
                emptyLabel="No quick action events yet."
              />
            )}
          </section>

          <section>
            <h2 className="admin-section-label mb-4">Top active users</h2>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
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
                        <td>
                          <div className="text-sm text-white">{row.email ?? row.principal}</div>
                          {row.email && row.email !== row.principal ? (
                            <div className="font-mono text-xs text-coop-muted">{row.principal}</div>
                          ) : null}
                        </td>
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
          <section className="admin-card p-4">
            <h2 className="admin-section-label mb-3">Completion volume by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <AnalyticsLineChart
                data={completions?.eventsByDay ?? []}
                emptyLabel="No completion usage events in this range."
              />
            )}
          </section>
        </div>
      )}

      {activeTab === "users" && (
        <div className="space-y-6">
          {!loading && users.length === 0 ? (
            <PlaceholderCallout
              title="No org members yet"
              body="No org members yet. Invite teammates on the Users page so they can sign in with email or Google and appear in per-user activity. Automation API key usage is tracked as apikey:… in usage events, not in this table."
            />
          ) : null}
          <AdminStatRow>
            <AdminStat
              label="Active users"
              value={loading ? "—" : (overview?.activeUsers ?? 0)}
              hint={`${overview?.totalUsers ?? 0} total members`}
            />
            <AdminStat
              label="Inactive seats"
              value={loading ? "—" : (inactiveCount ?? "—")}
              hint={
                inactiveCount != null
                  ? `0 events in selected ${range}`
                  : "Computed when member list loads"
              }
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
                    {hasPerUserCar ? <th>CAR</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={hasPerUserCar ? 5 : 4} className="py-8 text-center text-coop-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={hasPerUserCar ? 5 : 4} className="py-8 text-center text-coop-muted">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => {
                      const events = eventsForUser(user);
                      const car = carForUser(user);
                      return (
                        <tr key={user.id}>
                          <td>{user.email}</td>
                          <td className="capitalize">{user.role}</td>
                          <td className="capitalize">{user.status}</td>
                          <td className="tabular-nums">{events}</td>
                          {hasPerUserCar ? (
                            <td className="tabular-nums">
                              {car != null ? formatPercent(car) : "—"}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
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
