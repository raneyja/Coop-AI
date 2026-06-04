import React, { useCallback, useEffect, useRef, useState } from "react";
import { SettingsPanel, Preferences } from "./components/SettingsPanel";
import type { SettingsScreen } from "./components/settings/types";
import { isSettingsScreen, settingsScreenParent } from "./components/settings/types";
import type { SettingsSaveKey } from "./components/SaveFlashLabel";
import type { SettingsTestKey } from "./components/TestButton";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import type { PromptLibraryItem } from "./components/promptLibraryTypes";
import { applyThemeMode } from "./theme";
import type { CodeHostProviderPreference, DecisionIntegrationProvider } from "../chat/types";

type PersistedSettingsState = {
  screen?: SettingsScreen;
};

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

type InboundMessage =
  | { type: "theme:update"; payload: { mode: "light" | "dark" | "high-contrast" } }
  | { type: "settings:state"; payload: Preferences }
  | { type: "settings:navigate"; payload: { screen: string } }
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
  hasGitHubAppInstalled: false,
  devMode: false,
  hasGitLabToken: false,
  hasGitLabAppInstalled: false,
  hasBitbucketCredentials: false,
  hasBitbucketAppInstalled: false,
  hasSlackToken: false,
  hasJiraCredentials: false,
  hasTeamsToken: false,
  jiraBaseUrl: "https://your-domain.atlassian.net"
};

const TEST_RESULT_FLASH_MS = 1500;
const SAVE_FLASH_MS = 2000;
const TEST_TIMEOUT_MS = 12000;
/** Poll code-host OAuth install status while settings is open (catches uninstall without manual refresh). */
const CODE_HOST_INSTALL_POLL_MS = 30_000;

type SettingsViewProps = {
  vscode: VsCodeApi;
};

export function SettingsView({ vscode }: SettingsViewProps): React.ReactElement {
  const persisted = (vscode.getState() as PersistedSettingsState | null) ?? null;
  const [screen, setScreen] = useState<SettingsScreen>(persisted?.screen ?? "hub");
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
  const [savedFlashKey, setSavedFlashKey] = useState<SettingsSaveKey | null>(null);
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
  const savedFlashTimerRef = useRef<number | null>(null);
  const githubInstalledRef = useRef(false);
  const gitlabInstalledRef = useRef(false);
  const bitbucketInstalledRef = useRef(false);

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);

  const pollCodeHostInstallations = useCallback(() => {
    post({ type: "settings:refresh-github-installation" });
    post({ type: "settings:refresh-gitlab-installation" });
    post({ type: "settings:refresh-bitbucket-installation" });
  }, [post]);

  const flashSaved = useCallback((key: SettingsSaveKey) => {
    if (savedFlashTimerRef.current !== null) {
      window.clearTimeout(savedFlashTimerRef.current);
    }
    setSavedFlashKey(key);
    savedFlashTimerRef.current = window.setTimeout(() => {
      setSavedFlashKey(null);
      savedFlashTimerRef.current = null;
    }, SAVE_FLASH_MS);
  }, []);

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

  const navigate = useCallback(
    (next: SettingsScreen) => {
      setScreen(next);
      vscode.setState({ screen: next } satisfies PersistedSettingsState);
    },
    [vscode]
  );

  const handleBack = useCallback(() => {
    navigate(settingsScreenParent(screen));
  }, [navigate, screen]);

  useEffect(() => {
    post({ type: "webview-ready" });
    const listener = (event: MessageEvent<InboundMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "theme:update":
          applyThemeMode(message.payload.mode);
          break;
        case "settings:state":
          if (githubInstalledRef.current && !message.payload.hasGitHubAppInstalled) {
            setConnectionTestMessage(
              "GitHub App installation was removed. Install it again to access repositories."
            );
            setConnectionTestOk(false);
          }
          githubInstalledRef.current = message.payload.hasGitHubAppInstalled;
          if (gitlabInstalledRef.current && !message.payload.hasGitLabAppInstalled) {
            setConnectionTestMessage(
              "GitLab authorization was removed. Authorize GitLab again to access repositories."
            );
            setConnectionTestOk(false);
          }
          gitlabInstalledRef.current = message.payload.hasGitLabAppInstalled;
          if (bitbucketInstalledRef.current && !message.payload.hasBitbucketAppInstalled) {
            setConnectionTestMessage(
              "Bitbucket authorization was removed. Authorize Bitbucket again to access repositories."
            );
            setConnectionTestOk(false);
          }
          bitbucketInstalledRef.current = message.payload.hasBitbucketAppInstalled;
          setPrefs(message.payload);
          break;
        case "settings:navigate": {
          const next = message.payload.screen;
          if (isSettingsScreen(next)) {
            setScreen(next);
            vscode.setState({ screen: next } satisfies PersistedSettingsState);
          }
          break;
        }
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
    pollCodeHostInstallations();
    const onFocus = () => pollCodeHostInstallations();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        pollCodeHostInstallations();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(pollCodeHostInstallations, CODE_HOST_INSTALL_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [pollCodeHostInstallations]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (promptModalOpen) {
          event.preventDefault();
          setPromptModalOpen(false);
          return;
        }
        if (screen !== "hub") {
          event.preventDefault();
          handleBack();
          return;
        }
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleBack, handleClose, promptModalOpen, screen]);

  useEffect(() => {
    return () => {
      if (testResultTimerRef.current !== null) {
        window.clearTimeout(testResultTimerRef.current);
      }
      if (testTimeoutRef.current !== null) {
        window.clearTimeout(testTimeoutRef.current);
      }
      if (savedFlashTimerRef.current !== null) {
        window.clearTimeout(savedFlashTimerRef.current);
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
      <div className="flex min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <SettingsPanel
        screen={screen}
        onNavigate={navigate}
        prefs={prefs}
        promptLibrary={promptLibrary}
        onUpdatePinnedPrompts={(pinnedIds) =>
          post({ type: "prompts:update-pinned", payload: { pinnedIds } })
        }
        onManagePromptLibrary={() => setPromptModalOpen(true)}
        connectionTestMessage={connectionTestMessage}
        connectionTestOk={connectionTestOk}
        savedFlashKey={savedFlashKey}
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
          setApiKeyDraft("");
          flashSaved("apiKey");
        }}
        onClearApiKey={() => {
          post({ type: "settings:clear-api-key" });
          setApiKeyDraft("");
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
          flashSaved("github");
        }}
        onClearGithubToken={() => {
          post({ type: "settings:clear-github-token" });
          setGithubTokenDraft("");
        }}
        onInstallGithubApp={() => post({ type: "settings:install-github-app" })}
        onRefreshGithubInstallation={() => post({ type: "settings:refresh-github-installation" })}
        onInstallGitlabApp={() => post({ type: "settings:install-gitlab-app" })}
        onRefreshGitlabInstallation={() => post({ type: "settings:refresh-gitlab-installation" })}
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
          flashSaved("gitlab");
        }}
        onClearGitlabToken={() => {
          post({ type: "settings:clear-gitlab-token" });
          setGitlabTokenDraft("");
        }}
        onInstallBitbucketApp={() => post({ type: "settings:install-bitbucket-app" })}
        onRefreshBitbucketInstallation={() => post({ type: "settings:refresh-bitbucket-installation" })}
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
          flashSaved("bitbucket");
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
          flashSaved("slack");
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
          flashSaved("jira");
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
          flashSaved("teams");
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
        onCommit={(payload) =>
          post({
            type: "prompts:commit",
            payload: {
              prompts: payload.prompts.map((prompt) => ({
                id: prompt.id,
                title: prompt.title,
                template: prompt.template ?? "",
                actionId: prompt.actionId
              })),
              pinnedIds: payload.pinnedIds
            }
          })
        }
      />
    </div>
  );
}
