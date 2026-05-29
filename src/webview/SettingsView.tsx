import React, { useCallback, useEffect, useState } from "react";
import { SettingsPanel, Preferences } from "./components/SettingsPanel";
import { applyThemeMode } from "./theme";
import type { DecisionIntegrationProvider } from "../chat/types";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

type InboundMessage =
  | { type: "theme:update"; payload: { mode: "light" | "dark" | "high-contrast" } }
  | { type: "settings:state"; payload: Preferences }
  | { type: "settings:test-result"; payload: { ok: boolean; message: string } };

const DEFAULT_PREFS: Preferences = {
  model: "claude-3-5-sonnet-20241022",
  llmProvider: "anthropic",
  temperature: 0.5,
  maxTokens: 2000,
  llmEnabled: true,
  autocompleteEnabled: false,
  useCachedResponses: true,
  includeSelection: true,
  includeActiveFile: true,
  apiBaseUrl: "https://api.coopai.dev",
  owner: "",
  repo: "",
  branch: "",
  hasApiKey: false,
  defaultCodeHost: "github",
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  hasGitHubToken: false,
  hasGitLabToken: false,
  hasBitbucketCredentials: false,
  hasSlackToken: false,
  hasJiraCredentials: false,
  hasTeamsToken: false,
  jiraBaseUrl: "https://your-domain.atlassian.net"
};

type SettingsViewProps = {
  vscode: VsCodeApi;
};

export function SettingsView({ vscode }: SettingsViewProps): React.ReactElement {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [githubTokenDraft, setGithubTokenDraft] = useState("");
  const [gitlabTokenDraft, setGitlabTokenDraft] = useState("");
  const [bitbucketUsernameDraft, setBitbucketUsernameDraft] = useState("");
  const [bitbucketPasswordDraft, setBitbucketPasswordDraft] = useState("");
  const [slackTokenDraft, setSlackTokenDraft] = useState("");
  const [jiraEmailDraft, setJiraEmailDraft] = useState("");
  const [jiraTokenDraft, setJiraTokenDraft] = useState("");
  const [teamsTokenDraft, setTeamsTokenDraft] = useState("");
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | undefined>();

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);

  const handleClose = useCallback(() => {
    post({ type: "ui:close-settings" });
  }, [post]);

  useEffect(() => {
    post({ type: "webview-ready" });
    const listener = (event: MessageEvent<InboundMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "theme:update":
          applyThemeMode(message.payload.mode);
          break;
        case "settings:state":
          setPrefs(message.payload);
          break;
        case "settings:test-result":
          setConnectionTestMessage(message.payload.message);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [post]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const testIntegration = (provider: DecisionIntegrationProvider) => {
    setConnectionTestMessage(undefined);
    post({ type: "settings:test-integration", payload: { provider } });
  };

  return (
    <div className="coop-settings-shell flex h-full min-h-0 w-full items-start justify-center overflow-y-auto p-6">
      <SettingsPanel
        prefs={prefs}
        connectionTestMessage={connectionTestMessage}
        onClose={handleClose}
        onUpdate={(partial) => post({ type: "settings:update", payload: partial })}
        apiKeyDraft={apiKeyDraft}
        onApiKeyDraftChange={setApiKeyDraft}
        onSaveApiKey={() => {
          const trimmed = apiKeyDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Type a key first (local dev can be `dev`).");
            return;
          }
          post({ type: "settings:update-api-key", payload: { apiKey: trimmed } });
          setConnectionTestMessage("API key saved. Click Test connection.");
        }}
        onClearApiKey={() => {
          post({ type: "settings:clear-api-key" });
          setConnectionTestMessage(undefined);
        }}
        onTestConnection={() => {
          setConnectionTestMessage(undefined);
          post({ type: "settings:test-connection" });
        }}
        onTestCodeHost={(provider) => {
          setConnectionTestMessage(undefined);
          post({ type: "settings:test-code-host", payload: { provider } });
        }}
        githubTokenDraft={githubTokenDraft}
        onGithubTokenDraftChange={setGithubTokenDraft}
        onSaveGithubToken={() => {
          const trimmed = githubTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a GitHub personal access token.");
            return;
          }
          post({ type: "settings:update-github-token", payload: { token: trimmed } });
          setGithubTokenDraft("");
          setConnectionTestMessage("GitHub token saved.");
        }}
        onClearGithubToken={() => {
          post({ type: "settings:clear-github-token" });
          setGithubTokenDraft("");
        }}
        gitlabTokenDraft={gitlabTokenDraft}
        onGitlabTokenDraftChange={setGitlabTokenDraft}
        onSaveGitlabToken={() => {
          const trimmed = gitlabTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a GitLab personal access token.");
            return;
          }
          post({ type: "settings:update-gitlab-token", payload: { token: trimmed } });
          setGitlabTokenDraft("");
          setConnectionTestMessage("GitLab token saved.");
        }}
        onClearGitlabToken={() => {
          post({ type: "settings:clear-gitlab-token" });
          setGitlabTokenDraft("");
        }}
        bitbucketUsernameDraft={bitbucketUsernameDraft}
        onBitbucketUsernameDraftChange={setBitbucketUsernameDraft}
        bitbucketPasswordDraft={bitbucketPasswordDraft}
        onBitbucketPasswordDraftChange={setBitbucketPasswordDraft}
        onSaveBitbucketCredentials={() => {
          if (!bitbucketUsernameDraft.trim() || !bitbucketPasswordDraft.trim()) {
            setConnectionTestMessage("Enter Bitbucket username and app password.");
            return;
          }
          post({
            type: "settings:update-bitbucket-credentials",
            payload: {
              username: bitbucketUsernameDraft.trim(),
              appPassword: bitbucketPasswordDraft.trim()
            }
          });
          setBitbucketPasswordDraft("");
          setConnectionTestMessage("Bitbucket credentials saved.");
        }}
        onClearBitbucketCredentials={() => {
          post({ type: "settings:clear-bitbucket-credentials" });
          setBitbucketUsernameDraft("");
          setBitbucketPasswordDraft("");
        }}
        slackTokenDraft={slackTokenDraft}
        onSlackTokenDraftChange={setSlackTokenDraft}
        onSaveSlackToken={() => {
          const trimmed = slackTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a Slack user token.");
            return;
          }
          post({ type: "settings:update-slack-token", payload: { token: trimmed } });
          setSlackTokenDraft("");
          setConnectionTestMessage("Slack token saved.");
        }}
        onClearSlackToken={() => {
          post({ type: "settings:clear-slack-token" });
          setSlackTokenDraft("");
        }}
        jiraEmailDraft={jiraEmailDraft}
        onJiraEmailDraftChange={setJiraEmailDraft}
        jiraTokenDraft={jiraTokenDraft}
        onJiraTokenDraftChange={setJiraTokenDraft}
        onSaveJiraCredentials={() => {
          const email = jiraEmailDraft.trim();
          const token = jiraTokenDraft.trim();
          if (!email || !token) {
            setConnectionTestMessage("Enter Jira account email and API token.");
            return;
          }
          post({
            type: "settings:update-jira-credentials",
            payload: {
              email,
              token,
              baseUrl: prefs.jiraBaseUrl
            }
          });
          setJiraTokenDraft("");
          setConnectionTestMessage("Jira credentials saved.");
        }}
        onClearJiraCredentials={() => {
          post({ type: "settings:clear-jira-credentials" });
          setJiraEmailDraft("");
          setJiraTokenDraft("");
        }}
        teamsTokenDraft={teamsTokenDraft}
        onTeamsTokenDraftChange={setTeamsTokenDraft}
        onSaveTeamsToken={() => {
          const trimmed = teamsTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a Microsoft Graph access token.");
            return;
          }
          post({ type: "settings:update-teams-token", payload: { token: trimmed } });
          setTeamsTokenDraft("");
          setConnectionTestMessage("Teams token saved.");
        }}
        onClearTeamsToken={() => {
          post({ type: "settings:clear-teams-token" });
          setTeamsTokenDraft("");
        }}
        onTestIntegration={testIntegration}
        onClearChat={() => post({ type: "chat:new" })}
        onExportChat={() => post({ type: "chat:export" })}
      />
    </div>
  );
}
