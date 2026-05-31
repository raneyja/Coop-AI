import React, { useCallback, useEffect, useRef, useState } from "react";
import { SettingsPanel, Preferences } from "./components/SettingsPanel";
import type { SettingsTestKey } from "./components/TestButton";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import type { PromptLibraryItem } from "./components/promptLibraryTypes";
import { applyThemeMode } from "./theme";
import type { CodeHostProviderPreference, DecisionIntegrationProvider } from "../chat/types";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

type InboundMessage =
  | { type: "theme:update"; payload: { mode: "light" | "dark" | "high-contrast" } }
  | { type: "settings:state"; payload: Preferences }
  | { type: "settings:test-result"; payload: { ok: boolean; message: string } }
  | {
      type: "prompts:list";
      payload: {
        prompts: PromptLibraryItem[];
        pinnedIds: string[];
        hasWorkspace: boolean;
      };
    };

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

const TEST_RESULT_FLASH_MS = 1500;
const TEST_TIMEOUT_MS = 12000;

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
  const [connectionTestOk, setConnectionTestOk] = useState<boolean | undefined>();
  const [pendingTest, setPendingTest] = useState<SettingsTestKey | null>(null);
  const [testResult, setTestResult] = useState<{ key: SettingsTestKey; ok: boolean } | null>(null);
  const [promptLibrary, setPromptLibrary] = useState<{
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  }>({ prompts: [], pinnedIds: [], hasWorkspace: false });
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const activeTestRef = useRef<SettingsTestKey | null>(null);
  const testResultTimerRef = useRef<number | null>(null);
  const testTimeoutRef = useRef<number | null>(null);

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);

  const clearTestFlash = useCallback(() => {
    if (testResultTimerRef.current !== null) {
      window.clearTimeout(testResultTimerRef.current);
      testResultTimerRef.current = null;
    }
    setTestResult(null);
  }, []);

  const clearTestTimeout = useCallback(() => {
    if (testTimeoutRef.current !== null) {
      window.clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = null;
    }
  }, []);

  const completeTest = useCallback(
    (payload: { ok: boolean; message: string }) => {
      const key = activeTestRef.current;
      if (!key) {
        return;
      }

      clearTestTimeout();
      setConnectionTestMessage(payload.message);
      setConnectionTestOk(payload.ok);
      setTestResult({ key, ok: payload.ok });

      if (testResultTimerRef.current !== null) {
        window.clearTimeout(testResultTimerRef.current);
      }
      testResultTimerRef.current = window.setTimeout(() => {
        setTestResult(null);
        testResultTimerRef.current = null;
      }, TEST_RESULT_FLASH_MS);

      activeTestRef.current = null;
      setPendingTest(null);
    },
    [clearTestTimeout]
  );

  const beginTest = useCallback(
    (key: SettingsTestKey) => {
      clearTestFlash();
      clearTestTimeout();
      setConnectionTestMessage(undefined);
      setConnectionTestOk(undefined);
      activeTestRef.current = key;
      setPendingTest(key);
      testTimeoutRef.current = window.setTimeout(() => {
        if (activeTestRef.current !== key) {
          return;
        }
        completeTest({
          ok: false,
          message: "Connection test timed out. Check your credentials and try again."
        });
      }, TEST_TIMEOUT_MS);
    },
    [clearTestFlash, clearTestTimeout, completeTest]
  );

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
          completeTest(message.payload);
          break;
        case "prompts:list":
          setPromptLibrary(message.payload);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [completeTest, post]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (promptModalOpen) {
          event.preventDefault();
          setPromptModalOpen(false);
          return;
        }
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, promptModalOpen]);

  useEffect(() => {
    return () => {
      if (testResultTimerRef.current !== null) {
        window.clearTimeout(testResultTimerRef.current);
      }
      if (testTimeoutRef.current !== null) {
        window.clearTimeout(testTimeoutRef.current);
      }
    };
  }, []);

  const testIntegration = (provider: DecisionIntegrationProvider) => {
    beginTest(provider);
    post({ type: "settings:test-integration", payload: { provider } });
  };

  const testCodeHost = (provider: CodeHostProviderPreference) => {
    beginTest(provider);
    post({ type: "settings:test-code-host", payload: { provider } });
  };

  return (
    <div className="coop-settings-shell coop-canvas-bg flex h-full min-h-0 w-full flex-col">
      <p className="coop-panel-narrow-notice" role="status">
        Widen the sidebar for the best experience.
      </p>
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-6">
        <SettingsPanel
        prefs={prefs}
        promptLibrary={promptLibrary}
        onUpdatePinnedPrompts={(pinnedIds) =>
          post({ type: "prompts:update-pinned", payload: { pinnedIds } })
        }
        onManagePromptLibrary={() => setPromptModalOpen(true)}
        connectionTestMessage={connectionTestMessage}
        connectionTestOk={connectionTestOk}
        pendingTest={pendingTest}
        testResult={testResult}
        onClose={handleClose}
        onUpdate={(partial) => post({ type: "settings:update", payload: partial })}
        apiKeyDraft={apiKeyDraft}
        onApiKeyDraftChange={setApiKeyDraft}
        onSaveApiKey={() => {
          const trimmed = apiKeyDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Type a key first (local dev can be `dev`).");
            setConnectionTestOk(undefined);
            return;
          }
          post({ type: "settings:update-api-key", payload: { apiKey: trimmed } });
          setConnectionTestMessage("API key saved. Click Test connection.");
        }}
        onClearApiKey={() => {
          post({ type: "settings:clear-api-key" });
          setConnectionTestMessage(undefined);
          setConnectionTestOk(undefined);
        }}
        onTestConnection={() => {
          beginTest("connection");
          post({ type: "settings:test-connection" });
        }}
        onTestCodeHost={testCodeHost}
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
        onClearChat={() => post({ type: "chat:clear" })}
      />
      </div>
      <PromptLibraryModal
        open={promptModalOpen}
        prompts={promptLibrary.prompts}
        pinnedIds={promptLibrary.pinnedIds}
        hasWorkspace={promptLibrary.hasWorkspace}
        onClose={() => setPromptModalOpen(false)}
        onSave={(payload) => post({ type: "prompts:save", payload })}
        onUpdate={(payload) => post({ type: "prompts:update", payload })}
        onDelete={(id) => post({ type: "prompts:delete", payload: { id } })}
        onUpdatePinned={(pinnedIds) => post({ type: "prompts:update-pinned", payload: { pinnedIds } })}
      />
    </div>
  );
}
