import React, { useEffect, useMemo, useState } from "react";
import type {
  DegradationFeatureStatusPayload,
  DegradationNotificationPayload,
  IntegrationHealthPayload
} from "./types";

type DegradationNotificationProps = {
  health: IntegrationHealthPayload[];
  featureStatuses: Record<string, DegradationFeatureStatusPayload>;
  notification?: DegradationNotificationPayload;
  onDismiss: () => void;
  onRetry: (provider?: string, feature?: string) => void;
  onRefresh: (feature?: string) => void;
  onOpenSettings?: () => void;
};

const CODE_HOST_PROVIDERS = new Set(["github", "gitlab", "bitbucket"]);

const TONES: Record<DegradationNotificationPayload["severity"], { border: string; background: string; foreground: string }> = {
  info: {
    border: "var(--vscode-inputValidation-infoBorder)",
    background: "var(--vscode-inputValidation-infoBackground)",
    foreground: "var(--vscode-inputValidation-infoForeground, var(--coop-panel-foreground))"
  },
  warning: {
    border: "var(--vscode-inputValidation-warningBorder)",
    background: "var(--vscode-inputValidation-warningBackground)",
    foreground: "var(--vscode-inputValidation-warningForeground, var(--coop-panel-foreground))"
  },
  critical: {
    border: "var(--vscode-inputValidation-errorBorder)",
    background: "var(--vscode-inputValidation-errorBackground)",
    foreground: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))"
  }
};

export function DegradationNotification({
  health,
  featureStatuses,
  notification,
  onDismiss,
  onRetry,
  onRefresh,
  onOpenSettings
}: DegradationNotificationProps): React.ReactElement | null {
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const summary = useMemo(() => summarizeHealth(health), [health]);

  useEffect(() => {
    if (!dashboardOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDashboardOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dashboardOpen]);

  if (!notification && health.length === 0) {
    return null;
  }

  return (
    <section className="mx-3 mb-2 space-y-1 text-xs" aria-live="polite">
      {notification ? (
        <div
          className="rounded-md border px-3 py-2"
          style={{
            borderColor: TONES[notification.severity].border,
            background: TONES[notification.severity].background,
            color: TONES[notification.severity].foreground
          }}
          role={notification.severity === "critical" ? "alert" : "status"}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{notification.title}</p>
              <p className="mt-0.5 break-words opacity-90">{notification.message}</p>
            </div>
            <button type="button" className="shrink-0 opacity-75 hover:opacity-100" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="coop-text-btn"
              onClick={() => onRetry(notification.provider, notification.feature)}
            >
              Retry Now
            </button>
            <button type="button" className="coop-text-btn" onClick={() => onRefresh(notification.feature)}>
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
            onClick={() => setDashboardOpen((open) => !open)}
            aria-expanded={dashboardOpen}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-3 shrink-0 text-[10px] opacity-70" aria-hidden="true">
                {dashboardOpen ? "▾" : "▸"}
              </span>
              Integration health
            </span>
            <span className="shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)]">{summary}</span>
          </button>
          {dashboardOpen ? (
            <button
              type="button"
              className="coop-text-btn shrink-0"
              onClick={() => setDashboardOpen(false)}
              aria-label="Close integration health"
            >
              Close
            </button>
          ) : null}
        </div>
        {dashboardOpen ? (
          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            <p className="text-[10px] text-[var(--vscode-descriptionForeground)]">
              Click <span className="font-medium">Close</span> or the header again to collapse. Press Esc.
            </p>
            <div className="grid grid-cols-2 gap-1">
              {health.map((entry) => (
                <IntegrationCard
                  key={entry.provider}
                  entry={entry}
                  onOpenSettings={onOpenSettings}
                />
              ))}
            </div>
            <div className="space-y-1">
              {Object.values(featureStatuses).map((status) => (
                <div key={status.feature} className="flex items-center justify-between gap-2">
                  <span className="truncate">{humanize(status.feature)}</span>
                  <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">{status.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function IntegrationCard({
  entry,
  onOpenSettings
}: {
  entry: IntegrationHealthPayload;
  onOpenSettings?: () => void;
}): React.ReactElement {
  const isCodeHost = CODE_HOST_PROVIDERS.has(entry.provider);
  const showConfigure = isCodeHost && entry.status !== "healthy" && onOpenSettings;

  return (
    <div className="rounded border border-[var(--vscode-widget-border)] px-2 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate">{humanize(entry.provider)}</span>
        <StatusPill status={entry.status} />
      </div>
      <p className="mt-0.5 break-words text-[10px] text-[var(--vscode-descriptionForeground)]">
        {entry.error || latencyText(entry.latency)}
      </p>
      {showConfigure ? (
        <button type="button" className="coop-text-btn mt-1 text-[10px]" onClick={onOpenSettings}>
          Add token in settings
        </button>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: IntegrationHealthPayload["status"] }): React.ReactElement {
  const color =
    status === "healthy"
      ? "var(--vscode-testing-iconPassed)"
      : status === "degraded"
        ? "var(--vscode-inputValidation-warningBorder)"
        : "var(--vscode-inputValidation-errorBorder)";
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ color }}>
      {status}
    </span>
  );
}

function summarizeHealth(health: IntegrationHealthPayload[]): string {
  const offline = health.filter((entry) => entry.status === "offline").length;
  const degraded = health.filter((entry) => entry.status === "degraded").length;
  if (offline > 0) {
    return `${offline} offline`;
  }
  if (degraded > 0) {
    return `${degraded} degraded`;
  }
  return "All systems online";
}

function latencyText(latency?: number): string {
  return latency === undefined ? "No recent check" : `${Math.round(latency)} ms`;
}

function humanize(value: string): string {
  return value
    .replace(/^coopAI\./, "")
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
