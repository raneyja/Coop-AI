import React from "react";
import type { IntegrationChatProvider } from "../../../chat/types";
import { ConnectionCard } from "./ConnectionCard";
import { integrationConnectionMeta, integrationDisplayName } from "./connectionCopy";
import { integrationConfigured } from "./subtitles";
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
  const cloudPath = !prefs.devMode;

  return (
    <>
      {cloudPath ? (
        <ConnectionCard
          name={name}
          meta={integrationConnectionMeta(prefs, provider)}
          connected={connected}
          description={description}
          connectLabel={connected ? `Manage ${name}` : `Connect ${name}`}
          onConnect={onConnect}
          onRefresh={onRefresh}
          refreshKey={testKey}
          pendingRefresh={pendingRefresh}
          refreshResult={refreshResult}
          onTest={connected ? onTest : undefined}
          testKey={testKey}
          testLabel={`Test ${name}`}
          pendingTest={pendingTest}
          testResult={testResult}
          footer={
            !connected ? (
              <p className="coop-settings-card-desc coop-prompt-modal-muted">
                Organization credentials are stored on the Coop server, not in VS Code.
              </p>
            ) : undefined
          }
        />
      ) : null}
      {extraFields}
      {prefs.devMode ? devFallback : null}
    </>
  );
}
