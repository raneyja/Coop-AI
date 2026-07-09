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
  type MeAnalyticsOverview,
  type MeAnalyticsProductMixItem
} from "@/lib/coopApi";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { quickActionLabelFromEventType } from "@/lib/quickActionLabels";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import {
  AnalyticsBarChart,
  AnalyticsLineChart,
  AnalyticsSparkline,
  DonutChart,
  type BarDatum
} from "@/components/analytics";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat & Actions" },
  { id: "completions", label: "Completions" }
] as const;

type TabId = (typeof TABS)[number]["id"];

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function productLabel(product: string): string {
  const map: Record<string, string> = {
    chat: "Chat",
    completions: "Completions",
    completion: "Completions",
    quick_actions: "Quick actions",
    quickActions: "Quick actions",
    edits: "Edits"
  };
  return map[product] ?? product.replace(/_/g, " ");
}

function mixFromBuckets(mix: {
  chat: number;
  completions: number;
  quickActions: number;
  edits: number;
}): BarDatum[] {
  return [
    { label: "Chat", value: mix.chat },
    { label: "Completions", value: mix.completions },
    { label: "Quick actions", value: mix.quickActions },
    { label: "Edits", value: mix.edits }
  ].filter((d) => d.value > 0);
}

function deriveProductMix(
  overview: MeAnalyticsOverview | null,
  chat: MeAnalyticsChat | null,
  completions: AnalyticsCompletions | null
): BarDatum[] {
  const mix = overview?.productMix;
  if (mix && !Array.isArray(mix)) {
    return mixFromBuckets({
      chat: mix.chat,
      completions: mix.completions,
      quickActions: mix.quickActions,
      edits: chat?.editRequested ?? 0
    });
  }
  if (Array.isArray(mix) && mix.length > 0) {
    return mix.map((item: MeAnalyticsProductMixItem) => ({
      label: productLabel(item.product),
      value: item.count
    }));
  }

  const chatCount = overview?.chatMessages ?? chat?.chatMessages ?? 0;
  const quickActions =
    overview?.quickActionCount ??
    (chat?.quickActions ?? []).reduce((sum, row) => sum + row.count, 0);
  const completionCount =
    overview?.completionEvents ??
    (completions
      ? completions.suggested + completions.accepted + completions.requested
      : 0);
  const editCount = chat?.editRequested ?? 0;

  return mixFromBuckets({
    chat: chatCount,
    completions: completionCount,
    quickActions,
    edits: editCount
  });
}

function PlaceholderCallout({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="admin-panel-inset text-sm text-coop-muted">
      <p className="font-medium text-white/90">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function CarHero({
  rate,
  suggested,
  accepted,
  loading,
  sparkline
}: {
  rate: number | null | undefined;
  suggested: number;
  accepted: number;
  loading: boolean;
  sparkline?: Array<{ day: string; count: number }>;
}): React.ReactElement {
  const display = loading ? "—" : rate != null ? formatPercent(rate) : "—";
  const hint =
    loading
      ? "Loading…"
      : rate != null
        ? `${accepted} accepted of ${suggested} suggested`
        : suggested === 0
          ? "No suggestions in this range"
          : "Acceptance rate unavailable";

  return (
    <div className="admin-card border-b border-coop-border/50 pb-6">
      <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">
        Completion acceptance rate
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <p className="text-4xl font-semibold tabular-nums tracking-tight text-coop-index sm:text-5xl">
            {display}
          </p>
          <p className="mb-1 max-w-sm text-sm text-coop-muted">{hint}</p>
        </div>
        {!loading && sparkline && sparkline.length > 0 ? (
          <AnalyticsSparkline
            data={sparkline}
            ariaLabel="Completion volume trend"
            width={120}
            height={36}
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs text-coop-muted">
        CAR = accepted ÷ suggested (ghost text shown in the editor).
      </p>
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

  const carRate = useMemo(() => {
    if (overview?.acceptanceRate != null) return overview.acceptanceRate;
    return completions?.acceptanceRate ?? null;
  }, [overview, completions]);

  const carSuggested = overview?.suggested ?? completions?.suggested ?? 0;
  const carAccepted = overview?.accepted ?? completions?.accepted ?? 0;

  const productMix = useMemo(
    () => deriveProductMix(overview, chat, completions),
    [overview, chat, completions]
  );

  const productMixTotal = useMemo(
    () => productMix.reduce((sum, d) => sum + d.value, 0),
    [productMix]
  );

  const quickActionBars: BarDatum[] = useMemo(
    () =>
      (chat?.quickActions ?? [])
        .map((row) => ({
          label: quickActionLabelFromEventType(row.eventType),
          value: row.count
        }))
        .sort((a, b) => b.value - a.value),
    [chat]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">My Analytics</h1>
          <p className="mt-1 text-sm text-coop-muted">
            Your personal Coop activity — chat, completions, quick actions, and edits.
          </p>
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
          <CarHero
            rate={carRate}
            suggested={carSuggested}
            accepted={carAccepted}
            loading={loading}
            sparkline={completions?.eventsByDay}
          />

          <AdminStatRow>
            <AdminStat
              label="Total events"
              value={loading ? "—" : (overview?.totalEvents ?? 0)}
              hint={`Selected ${range}`}
            />
            <AdminStat
              label="Chat messages"
              value={loading ? "—" : (overview?.chatMessages ?? chat?.chatMessages ?? 0)}
              hint={`Selected ${range}`}
            />
            <AdminStat
              label="Quick actions"
              value={loading ? "—" : (overview?.quickActionCount ?? quickActionTotal)}
              hint={`Selected ${range}`}
            />
            <AdminStat
              label="Suggested"
              value={loading ? "—" : carSuggested}
              hint="completion.suggested"
            />
          </AdminStatRow>

          <section className="admin-card">
            <h2 className="admin-section-label mb-4">Activity by day</h2>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-coop-muted">
                Loading…
              </div>
            ) : (
              <AnalyticsLineChart
                data={overview?.eventsByDay ?? []}
                emptyLabel="No usage events yet. Activity will appear here once you use Coop."
              />
            )}
          </section>

          <section className="admin-card">
            <h2 className="admin-section-label mb-4">Activity mix</h2>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-coop-muted">
                Loading…
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <DonutChart
                  data={productMix}
                  centerValue={productMixTotal}
                  centerLabel="events"
                  emptyLabel="No product activity in this range yet."
                />
                <AnalyticsBarChart
                  data={productMix}
                  orientation="horizontal"
                  emptyLabel="No product activity in this range yet."
                />
              </div>
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
          </AdminStatRow>

          <section className="admin-card">
            <h2 className="admin-section-label mb-4">Quick actions by type</h2>
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-coop-muted">
                Loading…
              </div>
            ) : (
              <AnalyticsBarChart
                data={quickActionBars}
                orientation="horizontal"
                emptyLabel="No quick action events yet."
                color="#58A6FF"
              />
            )}
          </section>

          <section className="admin-card">
            <h2 className="admin-section-label mb-4">Chat activity by day</h2>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-coop-muted">
                Loading…
              </div>
            ) : (
              <AnalyticsLineChart
                data={chat?.eventsByDay ?? []}
                series={[{ key: "count", label: "Chat events", color: "#58A6FF" }]}
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

          <CarHero
            rate={completions?.acceptanceRate}
            suggested={completions?.suggested ?? 0}
            accepted={completions?.accepted ?? 0}
            loading={loading}
            sparkline={completions?.eventsByDay}
          />

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
              label="Rejected"
              value={loading ? "—" : (completions?.rejected ?? 0)}
              hint="completion.rejected events"
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

          <section className="admin-card">
            <h2 className="admin-section-label mb-4">Completion volume by day</h2>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-coop-muted">
                Loading…
              </div>
            ) : (
              <AnalyticsLineChart
                data={completions?.eventsByDay ?? []}
                series={[{ key: "count", label: "Completions", color: "#D29922" }]}
                emptyLabel="No completion usage events in this range."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
