"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyticsRangeParams,
  fetchMeAnalyticsChat,
  fetchMeAnalyticsCompletions,
  fetchMeAnalyticsOverview,
  type AnalyticsCompletions,
  type AnalyticsRange,
  type MeAnalyticsChat,
  type MeAnalyticsOverview
} from "@/lib/coopApi";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { UnavailableBanner } from "@/components/UnavailableBanner";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat & Actions" },
  { id: "completions", label: "Completions" }
] as const;

type TabId = (typeof TABS)[number]["id"];

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

export default function MyUsagePage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<MeAnalyticsOverview | null>(null);
  const [chat, setChat] = useState<MeAnalyticsChat | null>(null);
  const [completions, setCompletions] = useState<AnalyticsCompletions | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => analyticsRangeParams(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [overviewResult, chatResult, completionsResult] = await Promise.all([
      fetchMeAnalyticsOverview(from, to),
      fetchMeAnalyticsChat(from, to),
      fetchMeAnalyticsCompletions(from, to)
    ]);

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
      setError(overviewResult.error ?? "Failed to load usage overview.");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">My Usage</h1>
          <p className="mt-1 text-sm text-coop-muted">Your Coop activity in this organization.</p>
        </div>
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
              label="Total events"
              value={loading ? "—" : (overview?.totalEvents ?? 0)}
              hint={`Selected ${range}`}
            />
          </AdminStatRow>

          <section>
            <h2 className="admin-section-label mb-4">Event volume by day</h2>
            {loading ? (
              <div className="py-8 text-center text-sm text-coop-muted">Loading…</div>
            ) : (
              <EventsByDayTable
                rows={overview?.eventsByDay ?? []}
                emptyLabel="No usage events yet. Activity will appear here once you use Coop."
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
        </div>
      )}

      {activeTab === "completions" && (
        <div className="space-y-6">
          {!loading && completions && completions.suggested === 0 && completions.accepted === 0 ? (
            <PlaceholderCallout
              title="No completion events yet"
              body="Counts appear when Coop autocomplete is enabled: ghost-text shown (completion.suggested), Tab accept (completion.accepted), and server inline requests (completion.requested)."
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
    </div>
  );
}
