import React, { useEffect, useMemo, useState } from "react";
import type { SettingsScreen } from "../chat/settingsScreens";
import { settingsScreenForProvider } from "../chat/settingsScreens";
import { CoopNavList, CoopNavRow } from "./components/CoopNavRow";
import { RefreshButton } from "./components/RefreshButton";
import type {
  DegradationFeatureStatusPayload,
  DegradationNotificationPayload,
  IntegrationHealthPayload
} from "./types";

type DegradationNotificationProps = {
  health: IntegrationHealthPayload[];
  featureStatuses: Record<string, DegradationFeatureStatusPayload>;
  notification?: DegradationNotificationPayload;
  compact?: boolean;
  onDismiss: () => void;
  onRetry: (provider?: string, feature?: string) => void;
  onRefresh: (feature?: string) => void;
  onOpenSettings?: (screen?: SettingsScreen) => void;
};

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
  compact = false,
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

  if (compact && !notification) {
    return null;
  }

  return (
    <section className={`text-xs ${compact ? "px-3 pb-1" : "mx-3 mb-2 space-y-2"}`} aria-live="polite">
      {notification ? (
        <div
          className="rounded-lg px-3 py-2.5"
          style={{
            border: `1px solid ${TONES[notification.severity].border}`,
            background: TONES[notification.severity].background,
            color: TONES[notification.severity].foreground
          }}
          role={notification.severity === "critical" ? "alert" : "status"}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium">{notification.title}</p>
              <p className="coop-settings-card-desc mt-0.5 break-words opacity-90">{notification.message}</p>
            </div>
            <button type="button" className="coop-settings-action-btn shrink-0" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
          <div className="coop-settings-actions mt-2">
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onRetry(notification.provider, notification.feature)}
            >
              Retry Now
            </button>
            <RefreshButton onClick={() => onRefresh(notification.feature)} />
          </div>
        </div>
      ) : null}

      <div className="coop-health-bar relative">
        {dashboardOpen ? (
          <div className="coop-health-panel coop-health-panel--overlay absolute left-0 right-0 top-full z-30 mt-2">
            <div className="coop-health-panel-scroll no-scrollbar">
              <section>
                <h3 className="coop-settings-section-label">Integrations</h3>
                <CoopNavList>
                  {health.map((entry) => (
                    <IntegrationRow
                      key={entry.provider}
                      entry={entry}
                      onOpenSettings={onOpenSettings}
                    />
                  ))}
                </CoopNavList>
              </section>

              {Object.values(featureStatuses).length > 0 ? (
                <section>
                  <h3 className="coop-settings-section-label">Features</h3>
                  <div className="coop-settings-card !space-y-0 !p-0">
                    {Object.values(featureStatuses).map((status) => (
                      <div key={status.feature} className="coop-health-feature-row px-3">
                        <span className="coop-health-feature-name">{humanize(status.feature)}</span>
                        <span className="coop-health-feature-label">{status.label}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <p className="coop-settings-card-desc">Click the header or Close to collapse. Press Esc.</p>
          </div>
        ) : null}

        <div className="coop-health-bar-row">
          <button
            type="button"
            className="coop-health-bar-toggle"
            onClick={() => setDashboardOpen((open) => !open)}
            aria-expanded={dashboardOpen}
          >
            <span className="coop-health-bar-title">
              <span className="w-3 shrink-0 text-[10px] opacity-60" aria-hidden="true">
                {dashboardOpen ? "▾" : "▸"}
              </span>
              Integration health
            </span>
            <span className="coop-health-bar-summary">{summary}</span>
          </button>
          {dashboardOpen ? (
            <div className="coop-settings-actions shrink-0">
              <RefreshButton
                onClick={() => onRefresh()}
                ariaLabel="Refresh integrations and clear cached context"
              />
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={() => setDashboardOpen(false)}
                aria-label="Close integration health"
              >
                Close
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function IntegrationRow({
  entry,
  onOpenSettings
}: {
  entry: IntegrationHealthPayload;
  onOpenSettings?: (screen?: SettingsScreen) => void;
}): React.ReactElement {
  const settingsScreen = settingsScreenForProvider(entry.provider);
  const subtitle =
    entry.status === "healthy"
      ? latencyText(entry.latency)
      : entry.error || "Not configured";

  return (
    <CoopNavRow
      title={humanize(entry.provider)}
      subtitle={subtitle}
      trailing={<StatusPill status={entry.status} />}
      onClick={() => {
        if (!onOpenSettings) {
          return;
        }
        onOpenSettings(settingsScreen ?? "hub");
      }}
    />
  );
}

function StatusPill({ status }: { status: IntegrationHealthPayload["status"] }): React.ReactElement {
  return <span className={`coop-health-status coop-health-status--${status}`}>{status}</span>;
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
