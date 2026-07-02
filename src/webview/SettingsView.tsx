import React, { useCallback, useEffect, useRef, useState } from "react";
import { SettingsPanel, Preferences } from "./components/SettingsPanel";
import type { SettingsScreen } from "./components/settings/types";
import { isSettingsScreen, migrateSettingsScreen, settingsScreenParent } from "./components/settings/types";
import type { SettingsSaveKey } from "./components/SaveFlashLabel";
import type { SettingsTestKey } from "./components/TestButton";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import type { PromptLibraryItem } from "./components/promptLibraryTypes";
import { applyThemeMode } from "./theme";
import type { CodeHostProviderPreference, IntegrationChatProvider } from "../chat/types";
import type { OrgCollectionSummary, SettingsStatePayload, GithubRepoOption, RepoContext } from "../chat/types";
import type { LightningModeState } from "../indexing/lightningTypes";
import type { SettingsLightningSummary } from "./components/settings/SettingsHub";
import type { ExplorerSearchState, ExplorerTreeState } from "./components/RemoteExplorerTree";
import { EMPTY_IDENTITY_DIRECTORY } from "../identity/types";

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
  | { type: "settings:state"; payload: SettingsStatePayload }
  | { type: "settings:navigate"; payload: { screen: string } }
  | { type: "settings:test-result"; payload: { ok: boolean; message: string } }
  | { type: "settings:refresh-result"; payload: { ok: boolean; message: string } }
  | { type: "settings:api-key-revealed"; payload: { apiKey: string } }
  | {
      type: "prompts:list";
      payload: {
        prompts: PromptLibraryItem[];
        pinnedIds: string[];
        hasWorkspace: boolean;
      };
    }
  | { type: "collections:list"; payload: { collections: OrgCollectionSummary[]; error?: string } }
  | {
      type: "github:repos:list-result";
      payload: {
        requestId?: string;
        repos: GithubRepoOption[];
        error?: string;
        loading?: boolean;
      };
    }
  | {
      type: "repo:tree";
      payload: {
        path: string;
        items: import("../chat/types").RemoteTreeNode[];
        scope?: "repos" | "files";
        error?: string;
        stale?: boolean;
        provider?: import("../chat/types").CodeHostProviderPreference;
        loading?: boolean;
      };
    }
  | {
      type: "repo:search-results";
      payload: {
        query: string;
        items: import("../chat/types").RemoteTreeNode[];
        error?: string;
        loading?: boolean;
      };
    }
  | {
      type: "workspace:repos:state";
      payload: {
        repos: GithubRepoOption[];
        selectedRepoIds: string[];
        selectedCount: number;
        limit: number | null;
        loading?: boolean;
        saving?: boolean;
        error?: string;
      };
    }
  | { type: "lightning:state"; payload: LightningModeState };

const DEFAULT_PREFS: Preferences = {
  model: "claude-sonnet-4-6",
  llmProvider: "anthropic",
  temperature: 0.5,
  maxTokens: 2000,
  llmEnabled: true,
  autocompleteEnabled: false,
  useCachedResponses: true,
  includeSelection: true,
  includeActiveFile: true,
  apiBaseUrl: "https://api.coop-ai.dev",
  owner: "",
  repo: "",
  branch: "",
  hasApiKey: false,
  isSignedIn: false,
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
  hasSlackInstalled: false,
  hasAtlassianInstalled: false,
  hasJiraCredentials: false,
  hasTeamsInstalled: false,
  hasTeamsToken: false,
  hasConfluenceCredentials: false,
  hasNotionInstalled: false,
  hasNotionToken: false,
  hasGoogleDocsInstalled: false,
  hasGoogleDocsToken: false,
  jiraBaseUrl: "https://your-domain.atlassian.net",
  confluenceBaseUrl: "https://your-domain.atlassian.net/wiki",
  searchScopeMode: "repo",
  searchCollectionId: "",
  timezone: "America/Los_Angeles",
  identityDirectory: { ...EMPTY_IDENTITY_DIRECTORY }
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
  const [screen, setScreen] = useState<SettingsScreen>(() =>
    migrateSettingsScreen(persisted?.screen ?? "hub")
  );
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const apiKeyBaselineRef = useRef<string | null>(null);
  const [githubTokenDraft, setGithubTokenDraft] = useState("");
  const [gitlabTokenDraft, setGitlabTokenDraft] = useState("");
  const [bitbucketUsernameDraft, setBitbucketUsernameDraft] = useState("");
  const [bitbucketPasswordDraft, setBitbucketPasswordDraft] = useState("");
  const [slackTokenDraft, setSlackTokenDraft] = useState("");
  const [jiraEmailDraft, setJiraEmailDraft] = useState("");
  const [jiraTokenDraft, setJiraTokenDraft] = useState("");
  const [teamsTokenDraft, setTeamsTokenDraft] = useState("");
  const [confluenceEmailDraft, setConfluenceEmailDraft] = useState("");
  const [confluenceTokenDraft, setConfluenceTokenDraft] = useState("");
  const [notionTokenDraft, setNotionTokenDraft] = useState("");
  const [googleDocsTokenDraft, setGoogleDocsTokenDraft] = useState("");
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | undefined>();
  const [connectionTestOk, setConnectionTestOk] = useState<boolean | undefined>();
  const [savedFlashKey, setSavedFlashKey] = useState<SettingsSaveKey | null>(null);
  const [pendingTest, setPendingTest] = useState<SettingsTestKey | null>(null);
  const [testResult, setTestResult] = useState<{ key: SettingsTestKey; ok: boolean } | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<SettingsTestKey | null>(null);
  const [refreshResult, setRefreshResult] = useState<{ key: SettingsTestKey; ok: boolean } | null>(null);
  const [promptLibrary, setPromptLibrary] = useState<{
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  }>({ prompts: [], pinnedIds: [], hasWorkspace: false });
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [collections, setCollections] = useState<OrgCollectionSummary[]>([]);
  const [collectionsError, setCollectionsError] = useState<string | undefined>();
  const [workspacePickerState, setWorkspacePickerState] = useState<{
    repos: GithubRepoOption[];
    selectedRepoIds: string[];
    selectedCount: number;
    limit: number | null;
    loading: boolean;
    saving: boolean;
    error?: string;
  }>({
    repos: [],
    selectedRepoIds: [],
    selectedCount: 0,
    limit: 3,
    loading: false,
    saving: false
  });
  const [lightningState, setLightningState] = useState<SettingsLightningSummary | null>(null);
  const activeTestRef = useRef<SettingsTestKey | null>(null);
  const activeRefreshRef = useRef<SettingsTestKey | null>(null);
  const testResultTimerRef = useRef<number | null>(null);
  const refreshResultTimerRef = useRef<number | null>(null);
  const testTimeoutRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const savedFlashTimerRef = useRef<number | null>(null);
  const githubInstalledRef = useRef(false);
  const gitlabInstalledRef = useRef(false);
  const bitbucketInstalledRef = useRef(false);
  const slackInstalledRef = useRef(false);
  const atlassianInstalledRef = useRef(false);

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);
  const requestCollections = useCallback(() => {
    post({ type: "collections:list-request" });
  }, [post]);

  const pollInstallations = useCallback(() => {
    post({ type: "settings:refresh-github-installation" });
    post({ type: "settings:refresh-gitlab-installation" });
    post({ type: "settings:refresh-bitbucket-installation" });
    post({ type: "settings:refresh-slack-installation" });
    post({ type: "settings:refresh-atlassian-installation" });
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

  const clearRefreshFlash = useCallback(() => {
    if (refreshResultTimerRef.current !== null) {
      window.clearTimeout(refreshResultTimerRef.current);
      refreshResultTimerRef.current = null;
    }
    setRefreshResult(null);
  }, []);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const completeRefresh = useCallback(
    (payload: { ok: boolean; message: string }) => {
      const key = activeRefreshRef.current;
      if (!key) {
        return;
      }

      clearRefreshTimeout();
      setConnectionTestMessage(payload.message);
      setConnectionTestOk(payload.ok);
      setRefreshResult({ key, ok: payload.ok });

      if (refreshResultTimerRef.current !== null) {
        window.clearTimeout(refreshResultTimerRef.current);
      }
      refreshResultTimerRef.current = window.setTimeout(() => {
        setRefreshResult(null);
        refreshResultTimerRef.current = null;
      }, TEST_RESULT_FLASH_MS);

      activeRefreshRef.current = null;
      setPendingRefresh(null);
    },
    [clearRefreshTimeout]
  );

  const beginRefresh = useCallback(
    (key: SettingsTestKey) => {
      clearRefreshFlash();
      clearRefreshTimeout();
      activeRefreshRef.current = key;
      setPendingRefresh(key);
      refreshTimeoutRef.current = window.setTimeout(() => {
        if (activeRefreshRef.current !== key) {
          return;
        }
        completeRefresh({
          ok: false,
          message: "Refresh timed out. Check your network and try again."
        });
      }, TEST_TIMEOUT_MS);
    },
    [clearRefreshFlash, clearRefreshTimeout, completeRefresh]
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
    if (screen !== "account") {
      setApiKeyDraft("");
      apiKeyBaselineRef.current = null;
    }
  }, [screen]);

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
          if (slackInstalledRef.current && !message.payload.hasSlackInstalled) {
            setConnectionTestMessage(
              "Slack authorization was removed. Connect Slack again to search threads and check presence."
            );
            setConnectionTestOk(false);
          }
          slackInstalledRef.current = message.payload.hasSlackInstalled;
          if (atlassianInstalledRef.current && !message.payload.hasAtlassianInstalled) {
            setConnectionTestMessage(
              "Atlassian authorization was removed. Connect again to use Jira and Confluence."
            );
            setConnectionTestOk(false);
          }
          atlassianInstalledRef.current = message.payload.hasAtlassianInstalled;
          if (!(message.payload.isSignedIn ?? message.payload.hasApiKey)) {
            setApiKeyDraft("");
            apiKeyBaselineRef.current = null;
          }
          setPrefs(message.payload);
          break;
        case "settings:navigate": {
          const next = migrateSettingsScreen(message.payload.screen);
          if (isSettingsScreen(next)) {
            setScreen(next);
            vscode.setState({ screen: next } satisfies PersistedSettingsState);
          }
          break;
        }
        case "settings:test-result":
          completeTest(message.payload);
          break;
        case "settings:refresh-result":
          completeRefresh(message.payload);
          break;
        case "settings:api-key-revealed":
          apiKeyBaselineRef.current = message.payload.apiKey;
          setApiKeyDraft(message.payload.apiKey);
          break;
        case "prompts:list":
          setPromptLibrary(message.payload);
          break;
        case "collections:list":
          setCollections(message.payload.collections);
          setCollectionsError(message.payload.error);
          break;
        case "workspace:repos:state":
          setWorkspacePickerState({
            repos: message.payload.repos,
            selectedRepoIds: message.payload.selectedRepoIds,
            selectedCount: message.payload.selectedCount,
            limit: message.payload.limit,
            loading: Boolean(message.payload.loading),
            saving: Boolean(message.payload.saving),
            error: message.payload.error
          });
          break;
        case "lightning:state":
          setLightningState({
            readyRepos: message.payload.readyRepos,
            indexingRepos: message.payload.indexingRepos,
            indexedRepoCount: message.payload.indexedRepoCount,
            indexedRepoLimit: message.payload.indexedRepoLimit
          });
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [completeRefresh, completeTest, post]);

  useEffect(() => {
    pollInstallations();
    const onFocus = () => pollInstallations();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        pollInstallations();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(pollInstallations, CODE_HOST_INSTALL_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [pollInstallations]);

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

  const testIntegration = (provider: IntegrationChatProvider) => {
    beginTest(provider);
    post({
      type: "settings:test-integration",
      payload: {
        provider,
        draft:
          provider === "confluence"
            ? {
                email: confluenceEmailDraft.trim() || undefined,
                token: confluenceTokenDraft.trim() || undefined,
                baseUrl: prefs.confluenceBaseUrl
              }
            : provider === "jira"
              ? {
                  email: jiraEmailDraft.trim() || undefined,
                  token: jiraTokenDraft.trim() || undefined,
                  baseUrl: prefs.jiraBaseUrl
                }
              : undefined
      }
    });
  };

  const testCodeHost = (provider: CodeHostProviderPreference) => {
    beginTest(provider);
    post({ type: "settings:test-code-host", payload: { provider } });
  };

  const refreshGithub = () => {
    beginRefresh("github");
    post({ type: "settings:refresh-github-installation" });
  };
  const refreshGitlab = () => {
    beginRefresh("gitlab");
    post({ type: "settings:refresh-gitlab-installation" });
  };
  const refreshBitbucket = () => {
    beginRefresh("bitbucket");
    post({ type: "settings:refresh-bitbucket-installation" });
  };
  const refreshSlack = () => {
    beginRefresh("slack");
    post({ type: "settings:refresh-slack-installation" });
  };
  const refreshAtlassian = (key: "jira" | "confluence") => {
    beginRefresh(key);
    post({ type: "settings:refresh-atlassian-installation", payload: { key } });
  };
  const refreshNotion = () => {
    beginRefresh("notion");
    post({ type: "settings:refresh-notion-installation" });
  };
  const refreshGoogleDocs = () => {
    beginRefresh("google-docs");
    post({ type: "settings:refresh-google-docs-installation" });
  };
  const refreshTeams = () => {
    beginRefresh("teams");
    post({ type: "settings:refresh-teams-installation" });
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
          apiKeyBaselineRef.current = null;
          flashSaved("apiKey");
        }}
        onCopyApiKey={() => post({ type: "settings:copy-api-key" })}
        onRevealApiKey={() => post({ type: "settings:reveal-api-key" })}
        onApiKeyBlurCommit={(value) => {
          const baseline = apiKeyBaselineRef.current;
          if (baseline !== null && value === baseline) {
            setApiKeyDraft("");
            apiKeyBaselineRef.current = null;
          }
        }}
        onSignInSso={(org) => post({ type: "settings:sign-in-sso", payload: org ? { org } : undefined })}
        onSignInPassword={(email, password) =>
          post({ type: "settings:sign-in-password", payload: { email, password } })
        }
        onSignInGoogle={() => post({ type: "settings:sign-in-google" })}
        onForgotPassword={(email) => post({ type: "settings:forgot-password", payload: { email } })}
        onSignOut={() => post({ type: "settings:sign-out" })}
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
        onRefreshGithubInstallation={refreshGithub}
        onInstallGitlabApp={() => post({ type: "settings:install-gitlab-app" })}
        onRefreshGitlabInstallation={refreshGitlab}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
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
        onRefreshBitbucketInstallation={refreshBitbucket}
        onInstallSlackApp={() => post({ type: "settings:install-slack-app" })}
        onRefreshSlackInstallation={refreshSlack}
        onInstallAtlassianApp={() => post({ type: "settings:install-atlassian-app" })}
        onRefreshAtlassianInstallation={refreshAtlassian}
        onInstallNotionApp={() => post({ type: "settings:install-notion-app" })}
        onRefreshNotionInstallation={refreshNotion}
        onInstallGoogleDocsApp={() => post({ type: "settings:install-google-docs-app" })}
        onRefreshGoogleDocsInstallation={refreshGoogleDocs}
        onInstallTeamsApp={() => post({ type: "settings:install-teams-app" })}
        onRefreshTeamsInstallation={refreshTeams}
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
        confluenceEmailDraft={confluenceEmailDraft}
        onConfluenceEmailDraftChange={setConfluenceEmailDraft}
        confluenceTokenDraft={confluenceTokenDraft}
        onConfluenceTokenDraftChange={setConfluenceTokenDraft}
        onSaveConfluenceCredentials={() => {
          const email = confluenceEmailDraft.trim();
          const token = confluenceTokenDraft.trim();
          if (!email || !token) {
            setConnectionTestMessage("Enter Confluence account email and API token.");
            return;
          }
          post({
            type: "settings:update-confluence-credentials",
            payload: {
              email,
              token,
              baseUrl: prefs.confluenceBaseUrl
            }
          });
          setConfluenceTokenDraft("");
          flashSaved("confluence");
        }}
        onClearConfluenceCredentials={() => {
          post({ type: "settings:clear-confluence-credentials" });
          setConfluenceEmailDraft("");
          setConfluenceTokenDraft("");
        }}
        onCopyJiraToConfluence={() => {
          post({ type: "settings:copy-jira-to-confluence" });
          setConfluenceEmailDraft("");
          setConfluenceTokenDraft("");
          flashSaved("confluence");
        }}
        notionTokenDraft={notionTokenDraft}
        onNotionTokenDraftChange={setNotionTokenDraft}
        onSaveNotionToken={() => {
          const trimmed = notionTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a Notion integration token.");
            return;
          }
          post({ type: "settings:update-notion-token", payload: { token: trimmed } });
          setNotionTokenDraft("");
          flashSaved("notion");
        }}
        onClearNotionToken={() => {
          post({ type: "settings:clear-notion-token" });
          setNotionTokenDraft("");
        }}
        googleDocsTokenDraft={googleDocsTokenDraft}
        onGoogleDocsTokenDraftChange={setGoogleDocsTokenDraft}
        onSaveGoogleDocsToken={() => {
          const trimmed = googleDocsTokenDraft.trim();
          if (!trimmed) {
            setConnectionTestMessage("Enter a Google Docs access token.");
            return;
          }
          post({ type: "settings:update-google-docs-token", payload: { token: trimmed } });
          setGoogleDocsTokenDraft("");
          flashSaved("google-docs");
        }}
        onClearGoogleDocsToken={() => {
          post({ type: "settings:clear-google-docs-token" });
          setGoogleDocsTokenDraft("");
        }}
        onTestIntegration={testIntegration}
        onSaveIdentityDirectory={(directory) => {
          post({ type: "settings:save-identity-directory", payload: { directory } });
          flashSaved("team");
        }}
        onClearChat={() => post({ type: "chat:clear" })}
        collections={collections}
        collectionsError={collectionsError}
        onRequestCollections={requestCollections}
        onLoadWorkspaceRepos={() => post({ type: "workspace:repos:load" })}
        onSaveWorkspaceRepos={(repoIds) => post({ type: "workspace:repos:save", payload: { repoIds } })}
        workspacePickerState={workspacePickerState}
        lightningState={lightningState}
      />
      </div>
      <PromptLibraryModal
        open={promptModalOpen}
        prompts={promptLibrary.prompts}
        pinnedIds={promptLibrary.pinnedIds}
        hasWorkspace={promptLibrary.hasWorkspace}
        onClose={() => setPromptModalOpen(false)}
        onRun={(id) => {
          setPromptModalOpen(false);
          post({ type: "prompts:run", payload: { id } });
        }}
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
