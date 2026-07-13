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
import { toInlineInsertText, sanitizeAfterDotMemberText, consolidateAfterDotRanked, isValidAfterDotInsertText } from "./completionFilter";
import { fetchAfterDotMemberCompletions } from "./memberCompletionProvider";
import { discardContextPayload } from "./privacy";
import { AutocompletePerformanceMonitor } from "./performance";
import { HotStreak } from "./hotStreak";
import { TriggerDetector, triggerContextFromVscode } from "./triggerDetector";
import { readLightningConfiguration } from "../config/lightningConfig";
import type { IndexBackend } from "../indexing/indexBackend";
import type {
  AutocompleteTelemetryEvent,
  ExtractedCodeContext,
  RankedCompletion
} from "./types";

export type CoopAutocompleteProviderOptions = {
  api: SecureApiClient;
  indexBackend?: IndexBackend;
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
      await vscode.commands.executeCommand("coopAI.setAutocompleteEnabled", true);
    }
    await markAutocompleteDiscoveryShown(context);
    const choice = await vscode.window.showInformationMessage(
      "Coop autocomplete enabled — repo is Deep-Indexed",
      "Turn off"
    );
    if (choice === "Turn off") {
      await vscode.commands.executeCommand("coopAI.setAutocompleteEnabled", false);
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
  private requestGeneration = 0;
  private readonly inFlightByHash = new Map<string, Promise<vscode.InlineCompletionItem[] | null>>();
  private pendingSchedule:
    | {
        generation: number;
        resolve: (value: vscode.InlineCompletionItem[] | null) => void;
        cancelListener: vscode.Disposable;
      }
    | undefined;
  private lastAuthWarningAt = 0;
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
      })
    );
    const unsubscribeTelemetry = this.performance.onEvent((event) =>
      this.options.onTelemetry?.(event)
    );
    this.disposables.push({ dispose: unsubscribeTelemetry });
  }

  public dispose(): void {
    this.supersedePendingSchedule();
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
      return null;
    }
    if (!isFileEligible(document)) {
      return null;
    }

    const extracted = analyzeDocumentContext(document, position);
    this.noteSupersededIfNeeded(extracted.contextHash);

    const cachedItems = this.buildCachedItems(document, position, extracted);
    if (cachedItems) {
      return cachedItems;
    }

    const inflight = this.inFlightByHash.get(extracted.contextHash);
    if (inflight) {
      return inflight;
    }

    const trigger = triggerContextFromVscode(context, this.manualInvoke);
    this.manualInvoke = false;

    const decision = this.triggerDetector.evaluate(this.settings, extracted, trigger, {
      hotStreakActive: this.hotStreak.isActive(),
      p95LatencyMs: this.performance.getRollingP95()
    });
    if (!decision.shouldRequest) {
      if (decision.reason === "unchanged_context") {
        const retryInflight = this.inFlightByHash.get(extracted.contextHash);
        if (retryInflight) {
          return retryInflight;
        }
        const retryCached = this.buildCachedItems(document, position, extracted);
        if (retryCached) {
          return retryCached;
        }
      }
      return null;
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
    if (reason !== "superseded") {
      this.triggerDetector.noteRejection();
      this.performance.recordReject(reason, languageId);
      this.lastAlternatives = [];
      this.alternativeIndex = 0;
    }
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

  private supersedePendingSchedule(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pendingSchedule) {
      this.pendingSchedule.cancelListener.dispose();
      this.pendingSchedule.resolve(null);
      this.pendingSchedule = undefined;
    }
  }

  private scheduleRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext,
    debounceMs: number,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    const generation = ++this.requestGeneration;
    this.supersedePendingSchedule();

    return new Promise((resolve) => {
      let vscodeCancelled = false;
      const cancelListener = token.onCancellationRequested(() => {
        vscodeCancelled = true;
      });
      const pending = { generation, resolve, cancelListener };
      this.pendingSchedule = pending;

      const finish = (items: vscode.InlineCompletionItem[] | null) => {
        if (this.pendingSchedule === pending) {
          this.pendingSchedule = undefined;
        }
        cancelListener.dispose();
        resolve(items);
      };

      const run = () => {
        if (generation !== this.requestGeneration) {
          finish(null);
          return;
        }

        const existing = this.inFlightByHash.get(extracted.contextHash);
        if (existing) {
          void existing.then(finish);
          return;
        }

        const promise = this.executeRequest(document, position, extracted);
        this.inFlightByHash.set(extracted.contextHash, promise);
        void promise.finally(() => {
          if (this.inFlightByHash.get(extracted.contextHash) === promise) {
            this.inFlightByHash.delete(extracted.contextHash);
          }
        });

        void promise.then((items) => {
          if (vscodeCancelled && items && items.length > 0) {
            void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
          }
          finish(items);
        });
      };

      if (debounceMs <= 0) {
        run();
      } else {
        this.debounceTimer = setTimeout(run, debounceMs);
      }
    });
  }

  private buildCachedItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext
  ): vscode.InlineCompletionItem[] | null {
    if (this.lastAlternatives.length === 0 || extracted.contextHash !== this.lastScopeHash) {
      return null;
    }
    const item = this.buildInlineItem(
      document,
      position,
      extracted,
      this.lastAlternatives[this.alternativeIndex]
    );
    if (!item) {
      return null;
    }
    this.trackShownItem(extracted.contextHash, extracted.languageId);
    return [item];
  }

  private resolveLiveCompletionContext(
    document: vscode.TextDocument,
    fallbackPosition: vscode.Position
  ): { position: vscode.Position; extracted: ExtractedCodeContext } {
    const editor = vscode.window.activeTextEditor;
    const position =
      editor && editor.document.uri.toString() === document.uri.toString()
        ? editor.selection.active
        : fallbackPosition;
    return {
      position,
      extracted: analyzeDocumentContext(document, position)
    };
  }

  private isCompatibleCompletionContext(
    requested: ExtractedCodeContext,
    live: ExtractedCodeContext
  ): boolean {
    if (requested.contextHash === live.contextHash) {
      return true;
    }
    if (requested.filePath !== live.filePath) {
      return false;
    }
    const reqPrefix = requested.currentLinePrefix.trimEnd();
    const livePrefix = live.currentLinePrefix.trimEnd();
    return livePrefix === reqPrefix || livePrefix.startsWith(reqPrefix) || reqPrefix.startsWith(livePrefix);
  }

  private async executeRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext
  ): Promise<vscode.InlineCompletionItem[] | null> {
    let live = this.resolveLiveCompletionContext(document, position);
    position = live.position;
    extracted = live.extracted;
    this.noteSupersededIfNeeded(extracted.contextHash);

    const abort = new AbortController();
    try {
      if (extracted.afterDot) {
        const lspItems = await this.tryLspMemberCompletions(document, position, extracted, abort.signal);
        live = this.resolveLiveCompletionContext(document, position);
        if (
          lspItems &&
          lspItems.length > 0 &&
          this.isCompatibleCompletionContext(extracted, live.extracted)
        ) {
          position = live.position;
          extracted = live.extracted;
          discardContextPayload(extracted);
          // IntelliSense may be open after `.`; retrigger so ghost text can appear once it closes.
          setTimeout(() => {
            void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
          }, 50);
          return lspItems;
        }
        position = live.position;
        extracted = live.extracted;

        const llmFallback = await this.router.fetchCompletions(
          extracted,
          this.settings,
          abort.signal,
          document.getText().slice(0, 32_768)
        );
        live = this.resolveLiveCompletionContext(document, position);
        if (!this.isCompatibleCompletionContext(extracted, live.extracted)) {
          this.triggerDetector.noteRequestFailed();
          return null;
        }
        position = live.position;
        extracted = live.extracted;
        const consolidated = consolidateAfterDotRanked(
          llmFallback.completions,
          extracted.currentLinePrefix
        );
        return this.returnRankedInlineItems(
          document,
          position,
          extracted,
          consolidated,
          llmFallback.latencyMs
        );
      }

      const result = await this.router.fetchCompletions(
        extracted,
        this.settings,
        abort.signal,
        document.getText().slice(0, 32_768)
      );
      live = this.resolveLiveCompletionContext(document, position);
      if (!this.isCompatibleCompletionContext(extracted, live.extracted)) {
        this.triggerDetector.noteRequestFailed();
        return null;
      }
      position = live.position;
      extracted = live.extracted;

      if (result.completions.length === 0) {
        this.triggerDetector.noteRequestFailed();
        this.maybeWarnAuthFailure(result.error);
        return null;
      }

      const ranked = result.completions;
      return this.returnRankedInlineItems(
        document,
        position,
        extracted,
        ranked,
        result.latencyMs
      );
    } catch (error) {
      if (abort.signal.aborted) {
        this.triggerDetector.noteRequestFailed();
        return null;
      }
      this.triggerDetector.noteRequestFailed();
      const message = error instanceof Error ? error.message : "Autocomplete failed";
      this.maybeWarnAuthFailure(message);
      return null;
    }
  }

  private async tryLspMemberCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext,
    signal?: AbortSignal
  ): Promise<vscode.InlineCompletionItem[] | null> {
    const ranked = extracted.afterDot
      ? consolidateAfterDotRanked(
          await fetchAfterDotMemberCompletions(document, position, extracted, { signal }),
          extracted.currentLinePrefix
        )
      : await fetchAfterDotMemberCompletions(document, position, extracted, { signal });
    if (ranked.length === 0) {
      return null;
    }

    const items: vscode.InlineCompletionItem[] = [];
    for (const completion of ranked) {
      const item = this.buildInlineItem(document, position, extracted, completion);
      if (item) {
        items.push(item);
      }
    }
    if (items.length === 0) {
      return null;
    }

    this.lastAlternatives = ranked;
    this.alternativeIndex = 0;
    this.lastScopeHash = extracted.contextHash;
    this.triggerDetector.markRequested(extracted.contextHash);
    this.trackShownItem(extracted.contextHash, extracted.languageId);
    return this.settings.showMultipleSuggestions ? items : items.slice(0, 1);
  }

  private returnRankedInlineItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    extracted: ExtractedCodeContext,
    ranked: RankedCompletion[],
    latencyMs = 0
  ): vscode.InlineCompletionItem[] | null {
    if (ranked.length === 0) {
      this.triggerDetector.noteRequestFailed();
      return null;
    }

    this.lastAlternatives = ranked;
    this.alternativeIndex = 0;
    this.lastScopeHash = extracted.contextHash;

    const items: vscode.InlineCompletionItem[] = [];
    for (const completion of ranked) {
      const item = this.buildInlineItem(document, position, extracted, completion);
      if (item) {
        items.push(item);
      }
    }

    if (items.length === 0) {
      this.triggerDetector.noteRequestFailed();
      return null;
    }

    this.triggerDetector.markRequested(extracted.contextHash);
    this.trackShownItem(extracted.contextHash, extracted.languageId);
    discardContextPayload(extracted);
    return this.settings.showMultipleSuggestions ? items : items.slice(0, 1);
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
    let completionText = ranked.text;
    if (context.afterDot) {
      completionText = sanitizeAfterDotMemberText(completionText);
      if (!completionText) {
        return undefined;
      }
    }
    const insertText = toInlineInsertText(context, { ...ranked, text: completionText });
    if (!insertText || insertText.length < 2) {
      return undefined;
    }
    if (context.afterDot && !isValidAfterDotInsertText(insertText)) {
      return undefined;
    }

    const range = new vscode.Range(position, position);
    const item = new vscode.InlineCompletionItem(insertText, range);
    item.command = {
      title: "CoopAI autocomplete accepted",
      command: "coopAI.internal.autocompleteAccepted",
      arguments: [context.contextHash, context.languageId]
    };
    return item;
  }

  private maybeWarnAuthFailure(error: string | undefined): void {
    if (!error || !/api key is missing|sign in|not authenticated/i.test(error)) {
      return;
    }
    const now = Date.now();
    if (now - this.lastAuthWarningAt < 30_000) {
      return;
    }
    this.lastAuthWarningAt = now;
    void vscode.window.showWarningMessage(
      "Coop autocomplete requires sign-in. Open Coop chat → Settings → sign in in this Extension Development Host window."
    );
  }
}

export function registerCoopAutocomplete(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  onTelemetry?: (event: AutocompleteTelemetryEvent) => void,
  indexBackend?: IndexBackend
): CoopAutocompleteProvider {
  const provider = new CoopAutocompleteProvider({
    api,
    indexBackend,
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
