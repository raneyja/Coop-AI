import React from "react";
import type { IntegrationChatProvider } from "../../../chat/types";
import { ConnectionCard } from "./ConnectionCard";
import { integrationConnectionMeta, integrationDisplayName } from "./connectionCopy";
import { integrationConfigured, integrationOrgInstalled } from "./subtitles";
import type { Preferences } from "./types";
import type { SettingsTestKey } from "../TestButton";

type IntegrationConnectionShellProps = {
  provider: IntegrationChatProvider;
  prefs: Preferences;
  description: string;
  onConnect?: () => void;
  onRefresh?: () => void;
  onTest?: () => void;
  testKey: SettingsTestKey;
  pendingTest?: SettingsTestKey | null;
  testResult?: { key: SettingsTestKey; ok: boolean } | null;
  pendingRefresh?: SettingsTestKey | null;
  refreshResult?: { key: SettingsTestKey; ok: boolean } | null;
  devFallback?: React.ReactNode;
  extraFields?: React.ReactNode;
};

export function IntegrationConnectionShell({
  provider,
  prefs,
  description,
  onConnect,
  onRefresh,
  onTest,
  testKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult,
  devFallback,
  extraFields
}: IntegrationConnectionShellProps): React.ReactElement {
  const name = integrationDisplayName(provider);
  const connected = integrationConfigured(prefs, provider);
  const needsReconnect = provider === "slack" && Boolean(prefs.slackNeedsReconnect);
  const showDevFallback = Boolean(prefs.devMode && devFallback && !integrationOrgInstalled(prefs, provider));

  return (
    <>
      <ConnectionCard
        name={name}
        meta={integrationConnectionMeta(prefs, provider)}
        connected={connected && !needsReconnect}
        needsReconnect={needsReconnect}
        description={description}
        connectLabel={
          needsReconnect ? `Manage ${name}` : connected ? `Manage ${name}` : `Connect ${name}`
        }
        onConnect={onConnect}
        onRefresh={onRefresh}
        refreshKey={testKey}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
        onTest={onTest}
        testKey={testKey}
        testLabel={`Test ${name}`}
        pendingTest={pendingTest}
        testResult={testResult}
        footer={
          <p className="coop-settings-card-desc coop-prompt-modal-muted">
            {needsReconnect
              ? `Slack is linked but search isn’t ready. In the admin portal: Disconnect Slack, then Connect again. Return here and click Refresh status.`
              : connected
                ? `Manage ${name} opens the Coop admin portal — that’s where tools are connected and scoped.`
                : `Connect ${name} opens the Coop admin portal. Organization credentials stay on the Coop server, not in VS Code.`}
          </p>
        }
      />
      {extraFields}
      {showDevFallback ? devFallback : null}
    </>
  );
}
