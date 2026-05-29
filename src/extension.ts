import * as vscode from "vscode";
import { CoopChatPanel } from "./CoopChatPanel";
import { CoopSettingsPanel } from "./CoopSettingsPanel";
import { CoopSidebarProvider } from "./CoopSidebarProvider";
import { CoopChatSession } from "./chat/CoopChatSession";
import { coopSessionRegistry } from "./chat/CoopSessionRegistry";
import { getWebviewOptions } from "./chat/renderWebviewHtml";
import { readConfiguration, readDegradationConfiguration, SecureApiClient } from "./chat/SecureApiClient";
import { registerQuickActionCommands } from "./extension/quickActionCommands";
import {
  registerCoopAutocomplete,
  registerAutocompleteCommands
} from "./autocomplete/registerAutocomplete";
import { LayeredDegradationCache } from "./cache/degradationCache";
import { CacheManager } from "./cache/CacheManager";
import { CodeHostRouter } from "./api/codeHosts/codeHostRouter";
import { CodeHostSecrets } from "./api/codeHosts/codeHostSecrets";
import type { CodeHostProvider } from "./api/codeHosts/types";
import { IntegrationSecrets } from "./api/integrations/integrationSecrets";
import { createDecisionArchaeologyEngine } from "./engines/decisionArchaeology";
import { registerDecisionArchaeologyEngine } from "./engines/decisionArchaeologyRegistry";
import { HealthMonitor, type IntegrationProvider } from "./integrations/healthMonitor";

function resolveSession(fallback: CoopChatSession): CoopChatSession {
  return coopSessionRegistry.getActive() ?? fallback;
}

export function activate(context: vscode.ExtensionContext): void {
  const api = new SecureApiClient(context.secrets);
  const codeHostSecrets = new CodeHostSecrets(context.secrets);
  const codeHostCache = new CacheManager({ storageUri: context.globalStorageUri });
  void codeHostCache.initialize();
  const codeHostRouter = new CodeHostRouter({ secrets: codeHostSecrets, cache: codeHostCache });
  const integrationSecrets = new IntegrationSecrets(context.secrets);
  registerDecisionArchaeologyEngine(
    createDecisionArchaeologyEngine({
      codeHostRouter,
      codeHostSecrets,
      integrationSecrets
    })
  );
  let degradationConfig = readDegradationConfiguration();
  const healthMonitor = new HealthMonitor({
    config: degradationConfig,
    adapters: createHealthAdapters(api, codeHostRouter, integrationSecrets),
    providers: ["github", "gitlab", "bitbucket", "slack", "jira", "teams"]
  });
  const degradationCache = new LayeredDegradationCache({ config: degradationConfig });
  healthMonitor.start();
  const services = { healthMonitor, degradationCache, codeHostRouter, codeHostSecrets, integrationSecrets };
  const provider = new CoopSidebarProvider(context.extensionUri, api, services);

  const refreshAllSessions = async () => {
    for (const session of coopSessionRegistry.getAll()) {
      await session.refreshPreferences();
    }
  };

  context.subscriptions.push(
    { dispose: () => healthMonitor.stop() },
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
      const { loadWorkspacePrompts, applyPromptTemplate, promptVariablesFromContext } = await import(
        "./prompts/workspacePromptLibrary"
      );
      const { repoContextFromEditor } = await import("./context/intentDetector");
      const prompts = await loadWorkspacePrompts();
      if (prompts.length === 0) {
        void vscode.window.showInformationMessage("Add prompts in .coop/prompts.json to use saved prompts.");
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
      const text = applyPromptTemplate(pick.entry.template, promptVariablesFromContext(context));
      await session.sendUserMessage(text, pick.entry.actionId);
    }),
    vscode.commands.registerCommand("coopAI.newChat", () => {
      resolveSession(provider.session).newChat();
    }),
    vscode.commands.registerCommand("coopAI.clearChat", () => {
      resolveSession(provider.session).newChat();
    }),
    vscode.commands.registerCommand("coopAI.openSettings", () => {
      resolveSession(provider.session).openSettings();
    }),
    vscode.commands.registerCommand("coopAI.exportChat", () => {
      return resolveSession(provider.session).exportChat();
    }),
    vscode.commands.registerCommand("coopAI.newChatEditor", () => {
      CoopChatPanel.create(context.extensionUri, api, services);
    }),
    vscode.commands.registerCommand("coopAI.newChatWindow", () => {
      CoopChatPanel.create(context.extensionUri, api, services, {
        moveToNewWindow: true
      });
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      for (const session of coopSessionRegistry.getAll()) {
        session.refreshEditorContext(editor);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      for (const session of coopSessionRegistry.getAll()) {
        session.refreshEditorContext(event.textEditor);
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
          healthMonitor.updateConfig(degradationConfig);
        }
        void refreshAllSessions();
      }
    })
  );

  registerQuickActionCommands(context, () => provider.session);

  const autocompleteProvider = registerCoopAutocomplete(context, api, (payload) => {
    for (const session of coopSessionRegistry.getAll()) {
      session.postAutocompleteStatus(payload);
    }
  });
  registerAutocompleteCommands(context, autocompleteProvider, (payload) => {
    for (const session of coopSessionRegistry.getAll()) {
      session.postAutocompleteStatus(payload);
    }
  });

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
  const integrationHealth = async (provider: "slack" | "jira" | "teams") => {
    const { testDecisionIntegration } = await import("./api/integrations/integrationTest");
    const started = Date.now();
    const response = await testDecisionIntegration(provider, integrationSecrets);
    const configured = response.message.includes("not configured");
    return {
      ok: response.ok,
      degraded: !response.ok && !configured,
      latency: Date.now() - started,
      error: response.ok ? undefined : response.message
    };
  };

  adapters.slack = {
    provider: "slack",
    healthCheck: async () => integrationHealth("slack")
  };
  adapters.jira = {
    provider: "jira",
    healthCheck: async () => integrationHealth("jira")
  };
  adapters.teams = {
    provider: "teams",
    healthCheck: async () => integrationHealth("teams")
  };
  return adapters;
}
