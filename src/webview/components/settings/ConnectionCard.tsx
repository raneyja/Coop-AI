import React from "react";
import { TestButton, type SettingsTestKey } from "../TestButton";

export type ConnectionCardProps = {
  name: string;
  meta: string;
  connected: boolean;
  required?: boolean;
  description?: string;
  adminNotice?: string;
  connectLabel?: string;
  onConnect?: () => void;
  connectDisabled?: boolean;
  onRefresh?: () => void;
  refreshLabel?: string;
  refreshKey?: SettingsTestKey;
  pendingRefresh?: SettingsTestKey | null;
  refreshResult?: { key: SettingsTestKey; ok: boolean } | null;
  onTest?: () => void;
  testKey?: SettingsTestKey;
  testLabel?: string;
  pendingTest?: SettingsTestKey | null;
  testResult?: { key: SettingsTestKey; ok: boolean } | null;
  footer?: React.ReactNode;
};

export function ConnectionCard({
  name,
  meta,
  connected,
  required = false,
  description,
  adminNotice,
  connectLabel,
  onConnect,
  connectDisabled = false,
  onRefresh,
  refreshLabel = "Refresh status",
  refreshKey,
  pendingRefresh,
  refreshResult,
  onTest,
  testKey,
  testLabel,
  pendingTest,
  testResult,
  footer
}: ConnectionCardProps): React.ReactElement {
  const statusLabel = connected ? "Connected" : required ? "Required" : "Not connected";

  return (
    <>
      {description ? <p className="coop-settings-card-desc">{description}</p> : null}
      {adminNotice ? <p className="coop-settings-card-desc">{adminNotice}</p> : null}
      <div className="coop-health-integration">
        <div>
          <div className="coop-health-integration-name">{name}</div>
          <div className="coop-health-integration-meta">{meta}</div>
        </div>
        <span
          className={`coop-health-status ${connected ? "coop-health-status--healthy" : required ? "coop-health-status--offline" : "coop-health-status--degraded"}`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="coop-settings-actions">
        {onConnect ? (
          <button
            type="button"
            className="coop-settings-action-btn"
            onClick={onConnect}
            disabled={connectDisabled}
          >
            {connectLabel ?? (connected ? "Manage connection" : `Connect ${name}`)}
          </button>
        ) : null}
        {onRefresh && refreshKey ? (
          <TestButton
            testKey={refreshKey}
            label={refreshLabel}
            pendingTest={pendingRefresh ?? null}
            testResult={refreshResult ?? null}
            onClick={onRefresh}
          />
        ) : onRefresh ? (
          <button type="button" className="coop-settings-action-btn" onClick={onRefresh}>
            {refreshLabel}
          </button>
        ) : null}
        {onTest && testKey && testLabel ? (
          <TestButton
            testKey={testKey}
            label={testLabel}
            pendingTest={pendingTest ?? null}
            testResult={testResult ?? null}
            onClick={onTest}
          />
        ) : null}
      </div>
      {footer}
    </>
  );
}
