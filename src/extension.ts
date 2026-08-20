import * as vscode from "vscode";
import { CoopChatPanel } from "./CoopChatPanel";
import { CoopSettingsPanel } from "./CoopSettingsPanel";
import { CoopSidebarProvider } from "./CoopSidebarProvider";
import { CoopChatSession } from "./chat/CoopChatSession";
import { coopSessionRegistry } from "./chat/CoopSessionRegistry";
import { getWebviewOptions } from "./chat/renderWebviewHtml";
import { readConfiguration, readDegradationConfiguration, SecureApiClient } from "./chat/SecureApiClient";
import { resolveSearchScopeForPlan } from "./license/planSearchScope";
import { registerQuickActionCommands } from "./extension/quickActionCommands";
import {
  registerCoopAutocomplete,
  registerAutocompleteCommands,
  registerAutocompleteIndexNotifier,
  createAutocompleteUsageTelemetryHandler
} from "./autocomplete/registerAutocomplete";
import { registerPatchCommands } from "./edit/registerPatchCommands";
import { readAutocompleteSettings, clearAutocompleteWorkspaceOverrides, restoreAutocompleteUnlessUserOptedOut } from "./autocomplete/autocompleteConfig";
import { LayeredDegradationCache } from "./cache/degradationCache";
import { CacheManager } from "./cache/CacheManager";
import { CodeHostRouter } from "./api/codeHosts/codeHostRouter";
import {
  isRemoteFileSearchFallbackCandidate,
  searchFilesViaCloudTree
} from "./api/codeHosts/cloudRepoFileSearchFallback";
import { CodeHostSecrets } from "./api/codeHosts/codeHostSecrets";
import { linesFromText } from "./api/codeHosts/codeHostHttp";
import type { CodeHostProvider } from "./api/codeHosts/types";
import { coordinatesFromRepoId } from "./api/codeHosts/types";
import { readLightningBackend } from "./config/lightningConfig";
import { IntegrationSecrets } from "./api/integrations/integrationSecrets";
import { createDecisionArchaeologyEngine } from "./engines/decisionArchaeology";
import { registerDecisionArchaeologyEngine } from "./engines/decisionArchaeologyRegistry";
import { createOwnershipGraphEngine } from "./engines/ownershipGraph";
import { registerOwnershipGraphEngine } from "./engines/ownershipGraphRegistry";
import { createAgentOrchestrator } from "./api/agent/AgentOrchestrator";
import { IndexedRepoWorkspace } from "./workspace/IndexedRepoWorkspace";
import { resolveLocalAbsolutePath } from "./context/localFileResolver";
import { createBlastRadiusAnalysisEngine } from "./engines/blastRadiusAnalysis";
import { registerBlastRadiusAnalysisEngine } from "./engines/blastRadiusAnalysisRegistry";
import {
  buildRepoSummaryEvidence,
  resolveRepoSummaryCoords
} from "./context/buildRepoSummaryContext";
import { registerIndexedRepoFileReader } from "./context/indexedRepoFileRegistry";
import { readRepoFileForContext } from "./context/indexedRepoContextEnrichment";
import { registerRepoSummaryLoader } from "./context/repoSummaryRegistry";
import { HealthMonitor, type IntegrationProvider } from "./integrations/healthMonitor";
import { getIndexManager } from "./indexing/indexManager";
import { createIndexBackend } from "./indexing/createIndexBackend";
import { LightningStatusBar } from "./extension/lightningStatusBar";
import { IdentityDirectoryStore } from "./identity/identityDirectoryStore";
import { registerIdentityDirectoryProvider } from "./identity/identityDirectoryRegistry";

function resolveSession(fallback: CoopChatSession): CoopChatSession {
  return coopSessionRegistry.getActive() ?? fallback;
}

type ClearChatTarget = "sidebar" | "editor";

function resolveClearChatSession(
  sidebarSession: CoopChatSession,
  target?: ClearChatTarget
): CoopChatSession {
  if (target === "sidebar") {
    return sidebarSession;
  }
  if (target === "editor") {
    return CoopChatPanel.getActive()?.getSession() ?? resolveSession(sidebarSession);
  }
  return resolveSession(sidebarSession);
}

export function activate(context: vscode.ExtensionContext): void {
  const api = new SecureApiClient(context.secrets);
  const codeHostSecrets = new CodeHostSecrets(context.secrets);
  const codeHostCache = new CacheManager({ storageUri: context.globalStorageUri });
  void codeHostCache.initialize();
  const getApiBaseUrl = () => readConfiguration().apiBaseUrl;
  // Prefer org OAuth via the cloud API whenever Lightning is on cloud — including
  // Extension Dev Host (`coopAI.devMode`). Local PATs are only for `lightning.backend=local`.
  const useCloudCodeHostProxy = () => readLightningBackend() === "cloud";
  const cloudCodeHostFileFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostFileFetcher = async ({
    repoId,
    path,
    coords
  }) => {
    const file = await api.fetchRepoFileViaCloud(getApiBaseUrl(), repoId, path, coords.branch);
    return {
      path: file.path,
      content: file.content,
      encoding: (file.encoding as "utf-8" | undefined) ?? "utf-8",
      branch: file.branch,
      truncated: file.truncated,
      size: file.content.length,
      lines: linesFromText(file.content)
    };
  };
  const cloudCodeHostTreeFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostTreeFetcher = async ({
    repoId,
    path,
    coords
  }) => {
    const tree = await api.fetchRepoTreeViaCloud(getApiBaseUrl(), repoId, path, coords.branch);
    return {
      path: tree.path,
      branch: tree.branch,
      entries: tree.entries
    };
  };
  const cloudCodeHostFileCountFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostFileCountFetcher =
    async ({ repoId, coords }) => {
      const counted = await api.fetchRepoFileCountViaCloud(getApiBaseUrl(), repoId, coords.branch);
      return { fileCount: counted.fileCount, truncated: counted.truncated };
    };
  const cloudCodeHostSearchFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostSearchFetcher = async ({
    repoId,
    query,
    coords,
    limit
  }) => {
    const baseUrl = getApiBaseUrl();
    const runTreeFallback = async (): Promise<Array<{ path: string; name: string }>> => {
      try {
        const config = readConfiguration();
        const searchScope = resolveSearchScopeForPlan({
          searchScopeMode: config.searchScopeMode,
          searchCollectionId: config.searchCollectionId
        });
        const remote = (await api.graphSearch(baseUrl, repoId, query, {
          mention: true,
          scope: searchScope.scope ?? "indexed",
          collectionId: searchScope.collectionId
        })) as { data?: Array<{ path?: string }> };
        const graphHits = (remote.data ?? [])
          .map((hit) => hit.path?.trim())
          .filter((path): path is string => Boolean(path))
          .map((path) => ({ path, name: path.split("/").pop() ?? path }));
        if (graphHits.length > 0) {
          return graphHits.slice(0, limit);
        }
      } catch {
        // Fall through to directory walk.
      }

      return searchFilesViaCloudTree(
        async (path) => {
          const tree = await api.fetchRepoTreeViaCloud(baseUrl, repoId, path, coords.branch);
          return {
            entries: tree.entries.map((entry) => ({
              path: entry.path,
              name: entry.name,
              type: entry.type
            }))
          };
        },
        query,
        limit
      );
    };

    try {
      const hits = await api.fetchRepoSearchViaCloud(baseUrl, repoId, query, coords.branch, limit);
      // Bitbucket/GitLab code search often returns empty for path-style queries; tree walk finds them.
      if (hits.length === 0 && (query.includes("/") || query.includes("."))) {
        const treeHits = await runTreeFallback();
        if (treeHits.length > 0) {
          return treeHits;
        }
      }
      return hits;
    } catch (primaryError) {
      if (!isRemoteFileSearchFallbackCandidate(primaryError)) {
        throw primaryError;
      }

      const treeHits = await runTreeFallback();
      if (treeHits.length > 0) {
        return treeHits;
      }

      throw primaryError;
    }
  };
  const cloudCodeHostRepoListFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostRepoListFetcher =
    async (provider = "github") => {
      const repos = await api.listCodeHostOrgRepos(getApiBaseUrl(), provider);
      return repos.map((entry) => ({
        provider,
        owner: entry.owner,
        repo: entry.name,
        branch: entry.defaultBranch
      }));
    };
  const cloudCodeHostBlameFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostBlameFetcher = async ({
    repoId,
    path,
    coords
  }) => api.fetchRepoBlameViaCloud(getApiBaseUrl(), repoId, path, coords.branch);
  const cloudCodeHostHistoryFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostHistoryFetcher = async ({
    repoId,
    path,
    coords,
    limit
  }) => api.fetchRepoHistoryViaCloud(getApiBaseUrl(), repoId, path, { branch: coords.branch, limit });
  const cloudCodeHostCommitFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostCommitFetcher = async ({
    repoId,
    sha,
    coords
  }) => api.fetchRepoCommitViaCloud(getApiBaseUrl(), repoId, sha, coords.branch);
  const cloudCodeHostPullsForFileFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostPullsForFileFetcher =
    async ({ repoId, path, coords, limit }) =>
      api.fetchRepoPullsForFileViaCloud(getApiBaseUrl(), repoId, path, { branch: coords.branch, limit });
  const cloudCodeHostPullCommentsFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostPullCommentsFetcher =
    async ({ repoId, prNumber, coords }) =>
      api.fetchRepoPullCommentsViaCloud(getApiBaseUrl(), repoId, prNumber, {
        branch: coords.branch,
        pullOwner: coords.owner,
        pullRepo: coords.repo
      });
  const cloudCodeHostPullDetailFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostPullDetailFetcher =
    async ({ repoId, prNumber, coords, commitSha }) =>
      api.fetchRepoPullDetailViaCloud(getApiBaseUrl(), repoId, prNumber, {
        branch: coords.branch,
        commitSha
      });
  const cloudCodeHostCommitPullsFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostCommitPullsFetcher =
    async ({ repoId, sha, coords }) =>
      api.fetchRepoCommitPullsViaCloud(getApiBaseUrl(), repoId, sha, coords.branch);
  const cloudCodeHostRepoMetadataFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostRepoMetadataFetcher =
    async ({ repoId, coords }) => api.fetchRepoMetadataViaCloud(getApiBaseUrl(), repoId, coords.branch);
  const cloudCodeHostRepoPullsFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostRepoPullsFetcher =
    async ({ repoId, coords, state, limit }) =>
      api.fetchRepoPullsViaCloud(getApiBaseUrl(), repoId, { branch: coords.branch, state, limit });
  const cloudCodeHostRepoIssuesFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostRepoIssuesFetcher =
    async ({ repoId, coords, state, limit }) =>
      api.fetchRepoIssuesViaCloud(getApiBaseUrl(), repoId, { branch: coords.branch, state, limit });
  const cloudCodeHostPullReviewsFetcher: import("./api/codeHosts/codeHostRouter").CloudCodeHostPullReviewsFetcher =
    async ({ repoId, prNumber, coords }) =>
      api.fetchRepoPullReviewsViaCloud(getApiBaseUrl(), repoId, prNumber, { branch: coords.branch });
  const cloudCodeHostHealthCheck = async (
    provider: CodeHostProvider
  ): Promise<{ ok: boolean; message: string }> => {
    if (!(await api.hasToken())) {
      return { ok: false, message: "Add your Coop API key first." };
    }
    const statusByProvider = {
      github: () => api.getGithubInstallationStatus(getApiBaseUrl()),
      gitlab: () => api.getGitlabInstallationStatus(getApiBaseUrl()),
      bitbucket: () => api.getBitbucketInstallationStatus(getApiBaseUrl())
    } as const;
    const labelByProvider = {
      github: "GitHub App",
      gitlab: "GitLab OAuth App",
      bitbucket: "Bitbucket OAuth App"
    } as const;
    const status = await statusByProvider[provider]();
    if (!status.installed) {
      return { ok: false, message: `Authorize ${labelByProvider[provider]} from settings.` };
    }
    if (provider === "github" && "needsReconnect" in status && status.needsReconnect) {
      return {
        ok: false,
        message: "GitHub access expired. Ask your org admin to reconnect GitHub in the admin portal (Integrations → GitHub)."
      };
    }
    return status.installed
      ? { ok: true, message: `${labelByProvider[provider]} is authorized for your organization.` }
      : { ok: false, message: `Authorize ${labelByProvider[provider]} from settings.` };
  };
  const codeHostRouter = new CodeHostRouter({
    secrets: codeHostSecrets,
    cache: codeHostCache,
    useCloudCodeHostProxy,
    cloudCodeHostFileFetcher,
    cloudCodeHostTreeFetcher,
    cloudCodeHostFileCountFetcher,
    cloudCodeHostSearchFetcher,
    cloudCodeHostRepoListFetcher,
    cloudCodeHostBlameFetcher,
    cloudCodeHostHistoryFetcher,
    cloudCodeHostCommitFetcher,
    cloudCodeHostPullsForFileFetcher,
    cloudCodeHostPullCommentsFetcher,
    cloudCodeHostPullDetailFetcher,
    cloudCodeHostCommitPullsFetcher,
    cloudCodeHostRepoMetadataFetcher,
    cloudCodeHostRepoPullsFetcher,
    cloudCodeHostRepoIssuesFetcher,
    cloudCodeHostPullReviewsFetcher,
    cloudCodeHostHealthCheck
  });
  const integrationSecrets = new IntegrationSecrets(context.secrets);
  integrationSecrets.setCloudFetcher(async () => {
    // Always load org credentials when signed in — including Extension Development Host.
    // coopAI.devMode must NOT skip this: otherwise Test Slack / chat use a stale local
    // bot token while Settings shows Connected from org install status.
    if (!(await api.hasToken())) {
      return {};
    }
    const baseUrl = getApiBaseUrl();
    const overlay: import("./api/integrations/integrationSecrets").IntegrationCredentials = {};
    try {
      const slackStatus = await api.getSlackInstallationStatus(baseUrl);
      if (slackStatus.installed) {
        const creds = await api.getIntegrationCredentials(baseUrl, "slack");
        overlay.slackToken = creds.accessToken;
      }
    } catch {
      /* non-fatal */
    }
    try {
      const atlassianStatus = await api.getAtlassianInstallationStatus(baseUrl);
      if (atlassianStatus.installed) {
        const creds = await api.getIntegrationCredentials(baseUrl, "atlassian");
        const siteUrl = creds.metadata.siteUrl?.replace(/\/+$/, "");
        overlay.jiraToken = creds.accessToken;
        overlay.confluenceToken = creds.accessToken;
        overlay.jiraEmail = creds.metadata.email;
        overlay.confluenceEmail = creds.metadata.email;
        overlay.atlassianCloudId = creds.metadata.cloudId;
        if (siteUrl) {
          overlay.jiraBaseUrl = siteUrl;
          overlay.confluenceBaseUrl = `${siteUrl}/wiki`;
        }
      }
    } catch {
      /* non-fatal */
    }
    try {
      const notionStatus = await api.getNotionInstallationStatus(baseUrl);
      if (notionStatus.installed) {
        const creds = await api.getIntegrationCredentials(baseUrl, "notion");
        overlay.notionToken = creds.accessToken;
      }
    } catch {
      /* non-fatal */
    }
    try {
      const googleStatus = await api.getGoogleDocsInstallationStatus(baseUrl);
      if (googleStatus.installed) {
        const creds = await api.getIntegrationCredentials(baseUrl, "google-docs");
        overlay.googleDocsToken = creds.accessToken;
      }
    } catch {
      /* non-fatal */
    }
    try {
      const teamsStatus = await api.getTeamsInstallationStatus(baseUrl);
      if (teamsStatus.installed) {
        const creds = await api.getIntegrationCredentials(baseUrl, "teams");
        overlay.teamsToken = creds.accessToken;
      }
    } catch {
      /* non-fatal */
    }
    return overlay;
  });
  registerDecisionArchaeologyEngine(
    createDecisionArchaeologyEngine({
      codeHostRouter,
      codeHostSecrets,
      integrationSecrets
    })
  );
  registerOwnershipGraphEngine(
    createOwnershipGraphEngine({
      codeHostRouter,
      codeHostSecrets,
      integrationSecrets
    })
  );
  registerIndexedRepoFileReader(async (request) =>
    readRepoFileForContext(
      { api, apiBaseUrl: getApiBaseUrl(), codeHostRouter },
      request
    )
  );
  registerRepoSummaryLoader(async (context) => {
    const params = context.request.params;
    const coords = resolveRepoSummaryCoords({
      owner: params.owner,
      repo: params.repo,
      repoId: params.repoId,
      branch: params.branch,
      provider: typeof params.provider === "string" ? params.provider : undefined
    });
    if (!coords) {
      return undefined;
    }

    return buildRepoSummaryEvidence({
      api,
      apiBaseUrl: readConfiguration().apiBaseUrl,
      codeHostRouter,
      owner: coords.owner,
      repo: coords.repo,
      branch: coords.branch,
      repoId: coords.repoId,
      activeFile: params.file,
      provider:
        typeof params.provider === "string" &&
        (params.provider === "gitlab" || params.provider === "bitbucket" || params.provider === "github")
          ? params.provider
          : undefined,
      resolveWorkspaceBranch: async (repoId) => {
        if (!(await api.hasToken())) {
          return undefined;
        }
        try {
          const workspace = await api.getWorkspaceRepos(readConfiguration().apiBaseUrl);
          const entry = workspace.repos.find(
            (item) => item.repoId === repoId || item.repoId.toLowerCase() === repoId.toLowerCase()
          );
          return entry?.defaultBranch?.trim() || undefined;
        } catch {
          return undefined;
        }
      }
    });
  });
  let degradationConfig = readDegradationConfiguration();
  const healthMonitor = new HealthMonitor({
    config: degradationConfig,
    adapters: createHealthAdapters(api, codeHostRouter, integrationSecrets),
    providers: ["github", "gitlab", "bitbucket", "slack", "jira", "teams", "confluence", "notion", "google-docs"]
  });
  const degradationCache = new LayeredDegradationCache({ config: degradationConfig });
  const indexManager = getIndexManager({ secrets: context.secrets });
  const indexBackend = createIndexBackend({
    indexManager,
    client: api.getBackendClient(),
    getBaseUrl: getApiBaseUrl,
    secrets: context.secrets
  });
  registerBlastRadiusAnalysisEngine(
    createBlastRadiusAnalysisEngine({
      codeHostRouter,
      integrationSecrets,
      indexBackend,
      resolveSlackScope: async () => {
        if (!(await api.hasToken())) {
          return undefined;
        }
        try {
          return await api.getIntegrationScope(getApiBaseUrl(), "slack");
        } catch {
          return undefined;
        }
      }
    })
  );
  const lightningStatusBar = new LightningStatusBar(indexBackend, getApiBaseUrl, context.secrets);
  const identityDirectoryStore = new IdentityDirectoryStore(context, api.getBackendClient());
  registerIdentityDirectoryProvider(() => identityDirectoryStore.load(readConfiguration().apiBaseUrl));
  const agentOrchestrator = createAgentOrchestrator({
    indexBackend,
    resolveAbsolutePath: resolveLocalAbsolutePath,
    listDirectory: async ({ path: dirPath, repoId }) => {
      const coords = repoId
        ? coordinatesFromRepoId(repoId.includes(":") ? repoId : `github:${repoId}`)
        : undefined;
      const tree = await codeHostRouter.getRepositoryTree(dirPath ?? "", coords ?? undefined);
      return {
        path: tree.path,
        branch: tree.branch,
        entries: (tree.entries ?? []).map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type
        }))
      };
    },
    getBlame: async ({ path: filePath, repoId }) => {
      const coords = repoId
        ? coordinatesFromRepoId(repoId.includes(":") ? repoId : `github:${repoId}`)
        : undefined;
      const blame = await codeHostRouter.getBlameData(filePath, coords ?? undefined);
      return { ...blame, path: filePath };
    },
    readRemoteFile: async ({ path: filePath, repoId }) =>
      new IndexedRepoWorkspace({
        api,
        apiBaseUrl: getApiBaseUrl(),
        codeHostRouter
      }).readFile({ repoId }, filePath)
  });
  const services = {
    healthMonitor,
    degradationCache,
    codeHostRouter,
    codeHostSecrets,
    integrationSecrets,
    indexManager,
    indexBackend,
    lightningStatusBar,
    identityDirectoryStore,
    agentOrchestrator
  };
  const provider = new CoopSidebarProvider(context.extensionUri, context, api, services);

  const refreshAllSessions = async () => {
    for (const session of coopSessionRegistry.getAll()) {
      await session.refreshPreferences();
    }
  };

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path !== "/auth/callback") {
          return;
        }
        const fragmentParams = new URLSearchParams(uri.fragment);
        const queryParams = new URLSearchParams(uri.query);
        const readParam = (key: string): string | undefined => {
          const value = fragmentParams.get(key) ?? queryParams.get(key);
          const trimmed = value?.trim();
          return trimmed || undefined;
        };

        const error = readParam("error");
        const message = readParam("message");
        if (error || message) {
          void vscode.window.showErrorMessage(message ?? error ?? "Sign-in failed.");
          return;
        }

        const token = readParam("coopToken");
        const refreshToken = readParam("coopRefresh");
        if (!token) {
          void vscode.window.showErrorMessage("Sign-in did not return a session token.");
          return;
        }

        void (async () => {
          try {
            await api.storeSession(token, refreshToken);
            await api.fetchMe(readConfiguration().apiBaseUrl);
            await refreshAllSessions();
            void vscode.window.showInformationMessage("Signed in to Coop.");
          } catch {
            await api.clearToken();
            await api.clearRefreshToken();
            void vscode.window.showErrorMessage(
              "Sign-in failed: could not verify your session. Try again or contact your admin."
            );
          }
        })();
      }
    })
  );

  context.subscriptions.push(
    lightningStatusBar,
    vscode.window.registerWebviewViewProvider("coopAI.sidebar", provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    provider,
    vscode.commands.registerCommand("coopAI.openSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.coopAI");
    }),
    vscode.commands.registerCommand("coopAI.traceDecisionFromContext", async () => {
      const editor = vscode.window.activeTextEditor;
      const session = resolveSession(provider.session);
      const preferences = readConfiguration();
      const { repoContextFromEditor } = await import("./context/intentDetector");
      const context = editor
        ? repoContextFromEditor(editor, preferences, {})
        : { owner: preferences.owner, repo: preferences.repo, branch: preferences.branch };
      await vscode.commands.executeCommand("workbench.view.extension.coopAI");
      await session.submitQuickAction("trace-decision", context);
    }),
    vscode.commands.registerCommand("coopAI.runSavedPrompt", async () => {
      const session = resolveSession(provider.session);
      const { loadWorkspacePrompts } = await import("./prompts/workspacePromptLibrary");
      const { repoContextFromEditor } = await import("./context/intentDetector");
      const prompts = await loadWorkspacePrompts();
      if (prompts.length === 0) {
        void vscode.window.showInformationMessage("Add prompts in your prompt library to use saved prompts.");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        prompts.map((entry) => ({ label: entry.title, description: entry.id, entry })),
        { placeHolder: "Select a saved prompt" }
      );
      if (!pick) {
        return;
      }
      await vscode.commands.executeCommand("workbench.view.extension.coopAI");
      const editor = vscode.window.activeTextEditor;
      const preferences = readConfiguration();
      const context = editor
        ? repoContextFromEditor(editor, preferences, {})
        : { owner: preferences.owner, repo: preferences.repo, branch: preferences.branch };
      if (editor) {
        session.refreshEditorContext(editor);
      }
      session.insertPromptLibraryEntry(pick.entry);
    }),
    vscode.commands.registerCommand("coopAI.newChat", () => {
      CoopChatPanel.create(context.extensionUri, context, api, services);
    }),
    vscode.commands.registerCommand("coopAI.clearChat", (args?: { target?: ClearChatTarget }) => {
      resolveClearChatSession(provider.session, args?.target).clearChat();
    }),
    vscode.commands.registerCommand("coopAI.openSettings", () => {
      resolveSession(provider.session).openSettings();
    }),
    vscode.commands.registerCommand("coopAI.openExtensionSettings", () => {
      void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:coop-ai.coop-ai");
    }),
    vscode.commands.registerCommand("coopAI.openLightningMode", () => {
      resolveSession(provider.session).openLightningPanel();
    }),
    vscode.commands.registerCommand("coopAI.openKeybindings", () => {
      void vscode.commands.executeCommand("workbench.action.openGlobalKeybindings");
    }),
    vscode.commands.registerCommand("coopAI.moveFocusedView", () => {
      void vscode.commands.executeCommand("workbench.action.moveFocusedView");
    }),
    vscode.commands.registerCommand("coopAI.moveEditorToNewWindow", () => {
      void vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    }),
    vscode.commands.registerCommand("coopAI.newChatEditor", () => {
      void vscode.commands.executeCommand("coopAI.newChat");
    }),
    vscode.commands.registerCommand("coopAI.newChatWindow", () => {
      CoopChatPanel.create(context.extensionUri, context, api, services, {
        moveToNewWindow: true
      });
    }),
    vscode.commands.registerCommand(
      "coopAI.openChatForRepo",
      async (payload: {
        provider?: CodeHostProvider;
        owner: string;
        repo: string;
        branch?: string;
      }) => {
        if (!payload?.owner || !payload?.repo) {
          return;
        }
        const preferences = readConfiguration();
        const panel = CoopChatPanel.create(context.extensionUri, context, api, services, {
          moveToNewWindow: true
        });
        const provider = payload.provider ?? preferences.defaultCodeHost;
        panel.getSession().setRepoContext({
          provider,
          owner: payload.owner,
          repo: payload.repo,
          branch: payload.branch
        });
        panel.panel.title = `${payload.owner}/${payload.repo}`;
      }
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      // Only the focused Coop session follows the editor — never broadcast to every
      // panel/sidebar (that re-chipped Window A's file into a blank new window).
      coopSessionRegistry.getActive()?.refreshEditorContext(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      coopSessionRegistry.getActive()?.refreshEditorContext(event.textEditor, {
        selectionChangeKind: event.kind
      });
    }),
    vscode.workspace.onDidCloseTextDocument(() => {
      for (const session of coopSessionRegistry.getAll()) {
        session.reconcileEditorFileChips();
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const session of coopSessionRegistry.getAll()) {
        session.reconcileEditorFileChips();
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      for (const session of coopSessionRegistry.getAll()) {
        session.handleThemeChange();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("coopAI")) {
        if (event.affectsConfiguration("coopAI.degradation")) {
          degradationConfig = readDegradationConfiguration();
        }
        if (event.affectsConfiguration("coopAI.lightning") || event.affectsConfiguration("coopAI.license")) {
          void lightningStatusBar.refresh();
        }
        if (event.affectsConfiguration("coopAI.autocomplete.enabled")) {
          void vscode.commands.executeCommand(
            "setContext",
            "coopAI.autocomplete.enabled",
            readAutocompleteSettings().enabled
          );
        }
        void refreshAllSessions();
      }
    })
  );

  registerQuickActionCommands(context, () => provider.session);

  const autocompleteProvider = registerCoopAutocomplete(
    context,
    api,
    createAutocompleteUsageTelemetryHandler((eventType, metadata) => {
      void api.recordUsageEvents(eventType, metadata).catch(() => undefined);
    }),
    indexBackend
  );
  registerAutocompleteCommands(context, api, autocompleteProvider);
  context.subscriptions.push(registerAutocompleteIndexNotifier(context, indexBackend));
  registerPatchCommands(context, api, () => provider.session);

  void (async () => {
    await clearAutocompleteWorkspaceOverrides();
    await restoreAutocompleteUnlessUserOptedOut(context);
    const enabled = readAutocompleteSettings().enabled;
    await vscode.commands.executeCommand("setContext", "coopAI.autocomplete.enabled", enabled);
    await refreshAllSessions();
  })();

  void vscode.commands.executeCommand(
    "setContext",
    "coopAI.autocomplete.enabled",
    readAutocompleteSettings().enabled
  );

  if (vscode.window.registerWebviewPanelSerializer) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(CoopChatPanel.viewType, {
        async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: unknown) {
          webviewPanel.webview.options = {
            ...getWebviewOptions(context.extensionUri),
            ...webviewPanel.webview.options
          };
          CoopChatPanel.revive(
            webviewPanel,
            context.extensionUri,
            context,
            api,
            services,
            (state as { sessionId?: string }) || {}
          );
        }
      }),
      vscode.window.registerWebviewPanelSerializer(CoopSettingsPanel.viewType, {
        async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
          webviewPanel.webview.options = {
            ...getWebviewOptions(context.extensionUri),
            ...webviewPanel.webview.options
          };
          CoopSettingsPanel.revive(
            webviewPanel,
            context.extensionUri,
            resolveSession(provider.session)
          );
        }
      })
    );
  }

  const reloadAllChatWebviews = (): void => {
    for (const session of coopSessionRegistry.getAll()) {
      session.reloadChatWebviewHtml();
    }
  };
  reloadAllChatWebviews();
  setTimeout(reloadAllChatWebviews, 0);
}

export function deactivate(): void {}

function createHealthAdapters(
  api: SecureApiClient,
  codeHostRouter: CodeHostRouter,
  integrationSecrets: IntegrationSecrets
): Partial<Record<IntegrationProvider, import("./integrations/healthMonitor").IntegrationHealthAdapter>> {
  const codeHosts: CodeHostProvider[] = ["github", "gitlab", "bitbucket"];
  const adapters: Partial<Record<IntegrationProvider, import("./integrations/healthMonitor").IntegrationHealthAdapter>> =
    Object.fromEntries(
      codeHosts.map((provider) => [
        provider,
        {
          provider,
          healthCheck: async () => {
            const started = Date.now();
            const response = await codeHostRouter.testProvider(provider);
            return {
              ok: response.ok,
              degraded: !response.ok,
              latency: Date.now() - started,
              error: response.ok ? undefined : response.message
            };
          }
        }
      ])
    );
  const integrationHealth = async (
    provider: import("./chat/types").IntegrationChatProvider
  ) => {
    const { testIntegrationChat } = await import("./api/integrations/integrationTest");
    const started = Date.now();
    const response = await testIntegrationChat(provider, integrationSecrets);
    const unconfigured =
      response.message.includes("not configured") || /\bare required\b/i.test(response.message);
    return {
      ok: response.ok || unconfigured,
      degraded: !response.ok && !unconfigured,
      latency: Date.now() - started,
      error: response.ok || unconfigured ? undefined : response.message
    };
  };

  for (const provider of [
    "slack",
    "jira",
    "teams",
    "confluence",
    "notion",
    "google-docs"
  ] as const) {
    adapters[provider] = {
      provider,
      healthCheck: async () => integrationHealth(provider)
    };
  }
  return adapters;
}



