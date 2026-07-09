import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import {
  findActiveRepoBecameHealthy,
  hasAutocompleteDiscoveryBeenShown,
  isAutocompleteUserDisabled,
  markAutocompleteDiscoveryShown,
  readAutocompleteSettings,
  onAutocompleteSettingsChanged,
  resolveAutocompleteActiveRepoId
} from "./autocompleteConfig";
import { analyzeDocumentContext, isFileEligible } from "./contextAnalyzer";
import { CompletionRouter } from "./completionRouter";
import { toInlineInsertText } from "./completionFilter";
import { discardContextPayload } from "./privacy";
import { AutocompletePerformanceMonitor } from "./performance";
import { HotStreak } from "./hotStreak";
import { TriggerDetector, triggerContextFromVscode } from "./triggerDetector";
import { readLightningConfiguration } from "../config/lightningConfig";
import type { IndexBackend } from "../indexing/indexBackend";
import type {
  AutocompleteStatusState,
  AutocompleteTelemetryEvent,
  ExtractedCodeContext,
  RankedCompletion
} from "./types";

export type AutocompleteStatusPublisher = (payload: {
  status: AutocompleteStatusState;
  message?: string;
  suggestionIndex?: number;
  suggestionCount?: number;
  latencyMs?: number;
}) => void;

export type CoopAutocompleteProviderOptions = {
  api: SecureApiClient;
  indexBackend?: IndexBackend;
  onStatus?: AutocompleteStatusPublisher;
  onTelemetry?: (event: AutocompleteTelemetryEvent) => void;
};

const SHOWN_ITEM_TTL_MS = 30_000;
const INDEX_READY_POLL_MS = 30_000;

export function registerAutocompleteIndexNotifier(
  context: vscode.ExtensionContext,
  indexBackend: IndexBackend
): vscode.Disposable {
  if (isAutocompleteUserDisabled(context) || hasAutocompleteDiscoveryBeenShown(context)) {
    return { dispose: () => undefined };
  }

  const repoStatuses = new Map<string, string>();
  let notified = false;

  const poll = async () => {
    if (
      notified ||
      isAutocompleteUserDisabled(context) ||
      hasAutocompleteDiscoveryBeenShown(context)
    ) {
      return;
    }

    const config = readLightningConfiguration();
    const statuses = await indexBackend.listRepoStatuses(config);
    const activeRepoId = resolveAutocompleteActiveRepoId();
    const becameHealthy = findActiveRepoBecameHealthy(statuses, repoStatuses, activeRepoId);

    for (const status of statuses) {
      repoStatuses.set(status.repoId, status.status);
    }

    if (!becameHealthy) {
      return;
    }

    notified = true;
    const settings = readAutocompleteSettings();
    if (!settings.enabled) {
      await vscode.commands.executeCommand(
        "coopAI.setAutocompleteEnabled",
        true,
        vscode.ConfigurationTarget.Workspace
      );
    }
    await markAutocompleteDiscoveryShown(context);
    const choice = await vscode.window.showInformationMessage(
      "Coop autocomplete enabled — repo is Deep-Indexed",
      "Turn off"
    );
    if (choice === "Turn off") {
      await vscode.commands.executeCommand(
        "coopAI.setAutocompleteEnabled",
        false,
        vscode.ConfigurationTarget.Workspace
      );
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, INDEX_READY_POLL_MS);

  return {
    dispose: () => {
      clearInterval(timer);
    }
  };
}

export class CoopAutocompleteProvider implements vscode.InlineCompletionItemProvider {
  private settings = readAutocompleteSettings();
  private readonly hotStreak = new HotStreak();
  private readonly triggerDetector = new TriggerDetector();
  private readonly performance = new AutocompletePerformanceMonitor();
  private readonly router: CompletionRouter;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAlternatives: RankedCompletion[] = [];
  private alternativeIndex = 0;
  private lastScopeHash = "";
  private manualInvoke = false;
  private lastShownContextHash = "";
  private lastShownAt = 0;
  private lastShownLanguageId: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly options: CoopAutocompleteProviderOptions) {
    this.router = new CompletionRouter({
      api: options.api,
      performance: this.performance,
      indexBackend: options.indexBackend
    });
    this.disposables.push(
      onAutocompleteSettingsChanged(() => {
        this.settings = readAutocompleteSettings();
        this.publishStatus(this.settings.enabled ? "ready" : "disabled");
      })
    );
    const unsubscribeTelemetry = this.performance.onEvent((event) =>
      this.options.onTelemetry?.(event)
    );
    this.disposables.push({ dispose: unsubscribeTelemetry });
    this.publishStatus(this.settings.enabled ? "ready" : "disabled");
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public setManualInvoke(value: boolean): void {
    this.manualInvoke = value;
  }

  public cycleSuggestion(direction: 1 | -1): void {
    if (this.lastAlternatives.length <= 1) {
      return;
    }
    this.alternativeIndex =
      (this.alternativeIndex + direction + this.lastAlternatives.length) %
      this.lastAlternatives.length;
    void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    this.publishStatus("ready", undefined, this.alternativeIndex + 1, this.lastAlternatives.length);
  }

  public getPerformanceSnapshot() {
    return this.performance.snapshot();
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
    this.settings = readAutocompleteSettings();
    if (!this.settings.enabled) {
      this.publishStatus("disabled");
      return null;
    }
    if (!isFileEligible(document)) {
      return null;
    }

    const extracted = analyzeDocumentContext(document, position);
    this.noteSupersededIfNeeded(extracted.contextHash);

    const trigger = triggerContextFromVscode(context, this.manualInvoke);
    this.manualInvoke = false;

    const decision = this.triggerDetector.evaluate(this.settings, extracted, trigger, {
      hotStreakActive: this.hotStreak.isActive(),
      p95LatencyMs: this.performance.getRollingP95()
    });
    if (!decision.shouldRequest) {
      if (decision.reason && decision.reason !== "unchanged_context") {
        this.publishStatus("ready", this.describeSkipReason(decision.reason));
      }
      return null;
    }

    if (this.lastAlternatives.length > 1 && extracted.contextHash === this.lastScopeHash) {
      const item = this.buildInlineItem(document, position, extracted, this.lastAlternatives[this.alternativeIndex]);
      if (item) {
        this.trackShownItem(extracted.contextHash, extracted.languageId);
        return [item];
      }
    }

    return this.scheduleRequest(document, position, extracted, decision.debounceMs, token);
  }

  public noteDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    this.hotStreak.noteKeystroke();
    this.triggerDetector.noteKeystroke();
    const pasted = event.contentChanges.some((change) => change.text.length > 1);
    if (pasted) {
      this.triggerDetector.notePaste();
    }
  }

  public noteSuggestionAccepted(contextHash: string, languageId?: string): void {
    this.clearLastShown();
    this.hotStreak.activate();
    this.triggerDetector.noteAcceptance(contextHash);
    this.performance.recordAccept(languageId);
    this.lastScopeHash = contextHash;
  }

  public noteSuggestionRejected(reason: string, languageId?: string): void {
    this.clearLastShown();
    this.triggerDetector.noteRejection();
    this.performance.recordReject(reason, languageId);
    this.lastAlternatives = [];
    this.alternativeIndex = 0;
  }

  /** Reject only when Coop recently showed a suggestion (avoids Copilot escape false positives). */
  public rejectActiveSuggestion(reason: string): { rejected: boolean; languageId?: string } {
    if (
      !this.lastShownContextHash ||
      Date.now() - this.lastShownAt > SHOWN_ITEM_TTL_MS
    ) {
      return { rejected: false };
    }
    const languageId = this.lastShownLanguageId;
    this.noteSuggestionRejected(reason, languageId);
    return { rejected: true, languageId };
  }

  private noteSupersededIfNeeded(newContextHash: string): void {
    if (
      !this.lastShownContextHash ||
      this.lastShownContextHash === newContextHash ||
      Date.now() - this.lastShownAt > SHOWN_ITEM_TTL_MS
    ) {
      return;
    }
    this.noteSuggestionRejected("superseded", this.lastShownLanguageId);
  }

  private trackShownItem(contextHash: string, languageId: string): void {
    this.lastShownContextHash = contextHash;
    this.lastShownAt = Date.now();
    this.lastShownLanguageId = languageId;
    this.performance.recordShow(languageId);
  }

  private clearLastShown(): void {
    this.lastShownContextHash = "";
    this.lastShownAt = 0;
    this.lastShownLanguageId = undefined;
  }

  private scheduleRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext,
    debounceMs: number,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    return new Promise((resolve) => {
      let cancelled = false;
      const cancelListener = token.onCancellationRequested(() => {
        cancelled = true;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = undefined;
        }
      });

      const run = () => {
        void this.executeRequest(document, position, extracted, token).then((items) => {
          cancelListener.dispose();
          if (cancelled && items && items.length > 0) {
            void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
            resolve(null);
            return;
          }
          resolve(items);
        });
      };

      if (debounceMs <= 0) {
        run();
      } else {
        this.debounceTimer = setTimeout(run, debounceMs);
      }
    });
  }

  private async executeRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (token.isCancellationRequested) {
      return null;
    }

    this.noteSupersededIfNeeded(extracted.contextHash);
    this.triggerDetector.markRequested(extracted.contextHash);
    this.publishStatus("processing");

    const abort = new AbortController();
    const cancelListener = token.onCancellationRequested(() => abort.abort());
    try {
      const result = await this.router.fetchCompletions(extracted, this.settings, abort.signal);
      if (token.isCancellationRequested) {
        return null;
      }
      if (result.completions.length === 0) {
        this.publishStatus("ready", this.describeEmptyResult(result));
        return null;
      }

      this.lastAlternatives = result.completions;
      this.alternativeIndex = 0;
      this.lastScopeHash = extracted.contextHash;

      const items: vscode.InlineCompletionItem[] = [];
      for (const ranked of result.completions) {
        const item = this.buildInlineItem(document, position, extracted, ranked);
        if (item) {
          items.push(item);
        }
      }

      if (items.length === 0) {
        this.publishStatus("ready", "Filtered low-quality suggestion");
        return null;
      }

      this.publishStatus(
        "ready",
        undefined,
        1,
        items.length,
        result.latencyMs
      );

      this.trackShownItem(extracted.contextHash, extracted.languageId);
      discardContextPayload(extracted);
      return this.settings.showMultipleSuggestions ? items : [items[0]];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Autocomplete failed";
      this.publishStatus("error", this.describeErrorMessage(message));
      return null;
    } finally {
      cancelListener.dispose();
    }
  }

  private buildInlineItem(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: ExtractedCodeContext,
    ranked: RankedCompletion | undefined
  ): vscode.InlineCompletionItem | undefined {
    if (!ranked) {
      return undefined;
    }
    const insertText = toInlineInsertText(context, ranked);
    if (!insertText || insertText.length < 2) {
      return undefined;
    }

    const range = new vscode.Range(position, position);
    const item = new vscode.InlineCompletionItem(insertText, range);
    item.filterText = context.currentLinePrefix + insertText;
    item.command = {
      title: "CoopAI autocomplete accepted",
      command: "coopAI.internal.autocompleteAccepted",
      arguments: [context.contextHash, context.languageId]
    };
    return item;
  }

  private describeSkipReason(reason: string): string {
    switch (reason) {
      case "backoff":
        return "Paused after dismissed suggestions";
      case "manual_only":
        return "Manual trigger only (Cmd+Shift+\\)";
      case "in_comment_or_string":
        return "Skipped in comment or string";
      case "post_accept_cooldown":
        return "Ready";
      default:
        return reason.replaceAll("_", " ");
    }
  }

  private describeEmptyResult(result: { error?: string; latencyMs: number }): string {
    if (result.error) {
      return this.describeErrorMessage(result.error);
    }
    if (result.latencyMs > 0) {
      return `No suggestion (${result.latencyMs}ms)`;
    }
    return "No suggestion";
  }

  private describeErrorMessage(message: string): string {
    if (/api key is missing|sign in|not authenticated/i.test(message)) {
      return "Sign in to Coop AI to use autocomplete";
    }
    if (/timed out/i.test(message)) {
      return "Autocomplete timed out — try again or increase request timeout";
    }
    return message;
  }

  private publishStatus(
    status: AutocompleteStatusState,
    message?: string,
    suggestionIndex?: number,
    suggestionCount?: number,
    latencyMs?: number
  ): void {
    this.options.onStatus?.({
      status,
      message,
      suggestionIndex,
      suggestionCount,
      latencyMs
    });
  }
}

export function registerCoopAutocomplete(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  publishStatus: AutocompleteStatusPublisher,
  onTelemetry?: (event: AutocompleteTelemetryEvent) => void,
  indexBackend?: IndexBackend
): CoopAutocompleteProvider {
  const provider = new CoopAutocompleteProvider({
    api,
    indexBackend,
    onStatus: publishStatus,
    onTelemetry
  });

  const selector: vscode.DocumentSelector = [
    { scheme: "file" },
    { scheme: "untitled" }
  ];

  context.subscriptions.push(
    provider,
    vscode.languages.registerInlineCompletionItemProvider(selector, provider),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === "file" || event.document.uri.scheme === "untitled") {
        provider.noteDocumentChange(event);
      }
    })
  );

  return provider;
}
