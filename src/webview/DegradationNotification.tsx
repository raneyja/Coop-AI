import React from "react";
import type { SettingsScreen } from "../chat/settingsScreens";
import {
  SETTINGS_SCREEN_TITLES,
  settingsScreenForProvider,
  type SettingsDetailScreen
} from "../chat/settingsScreens";
import { RefreshButton } from "./components/RefreshButton";
import type { DegradationNotificationPayload } from "./types";

type DegradationNotificationProps = {
  notification?: DegradationNotificationPayload;
  compact?: boolean;
  onDismiss: () => void;
  onRefresh: (feature?: string) => void;
  onOpenSettings?: (screen?: SettingsScreen) => void;
};

function severityTone(severity: DegradationNotificationPayload["severity"]): "info" | "warning" | "error" {
  if (severity === "critical") {
    return "error";
  }
  return severity;
}

export function DegradationNotification({
  notification,
  compact = false,
  onDismiss,
  onRefresh,
  onOpenSettings
}: DegradationNotificationProps): React.ReactElement | null {
  if (!notification) {
    return null;
  }

  const connectScreen = connectSettingsScreen(notification);
  const connectLabel = connectScreen ? connectButtonLabel(connectScreen) : undefined;

  return (
    <section className={`text-xs ${compact ? "px-3 pb-1" : "mx-3 mb-2"}`} aria-live="polite">
      <div
        className={`coop-notice coop-notice--stacked coop-notice--${severityTone(notification.severity)}`}
        role={notification.severity === "critical" ? "alert" : "status"}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="coop-notice-title">{notification.title}</p>
            <p className="coop-notice-body coop-notice-body--muted mt-0.5">{notification.message}</p>
          </div>
          <button type="button" className="coop-text-btn shrink-0" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
        <div className="coop-settings-actions mt-2">
          {connectScreen && connectLabel && onOpenSettings ? (
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onOpenSettings(connectScreen)}
            >
              {connectLabel}
            </button>
          ) : null}
          <RefreshButton
            label="Retry"
            ariaLabel="Retry context fetch"
            onClick={() => onRefresh(notification.feature)}
          />
        </div>
      </div>
    </section>
  );
}

function connectSettingsScreen(notification: DegradationNotificationPayload): SettingsScreen | undefined {
  if (notification.provider) {
    return settingsScreenForProvider(notification.provider) ?? "hub";
  }
  const fromMessage = notification.message.match(/\b(GitHub|GitLab|Bitbucket|Slack|Jira|Teams)\b/i);
  if (fromMessage) {
    const provider = fromMessage[1].toLowerCase() === "teams" ? "teams" : fromMessage[1].toLowerCase();
    return settingsScreenForProvider(provider) ?? "hub";
  }
  return undefined;
}

function connectButtonLabel(screen: SettingsScreen): string {
  if (screen === "hub") {
    return "Open Settings";
  }
  const title = SETTINGS_SCREEN_TITLES[screen as SettingsDetailScreen];
  return title ? `Connect ${title}` : "Open Settings";
}
