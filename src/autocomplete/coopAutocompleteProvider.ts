import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import { readAutocompleteSettings, onAutocompleteSettingsChanged } from "./autocompleteConfig";
import { analyzeDocumentContext, isFileEligible } from "./contextAnalyzer";
import { CompletionRouter } from "./completionRouter";
import { toInlineInsertText } from "./completionFilter";
import { discardContextPayload } from "./privacy";
import { AutocompletePerformanceMonitor } from "./performance";
import { HotStreak } from "./hotStreak";
import { TriggerDetector, triggerContextFromVscode } from "./triggerDetector";
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
  onStatus?: AutocompleteStatusPublisher;
  onTelemetry?: (event: AutocompleteTelemetryEvent) => void;
};

const SHOWN_ITEM_TTL_MS = 30_000;

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
    this.router = new CompletionRouter({ api: options.api, performance: this.performance });
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
      const run = () => {
        void this.executeRequest(document, position, extracted, token).then((items) => {
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
      if (token.isCancellationRequested || result.completions.length === 0) {
        this.publishStatus("ready", result.latencyMs ? `idle (${result.latencyMs}ms)` : undefined);
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
        this.publishStatus("ready");
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
      this.publishStatus(
        "error",
        error instanceof Error ? error.message : "Autocomplete failed"
      );
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
  onTelemetry?: (event: AutocompleteTelemetryEvent) => void
): CoopAutocompleteProvider {
  const provider = new CoopAutocompleteProvider({ api, onStatus: publishStatus, onTelemetry });

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
