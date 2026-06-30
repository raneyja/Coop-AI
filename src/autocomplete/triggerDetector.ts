import * as vscode from "vscode";
import { SmartThrottle } from "./smartThrottle";
import type { AutocompleteSettings, CompletionTriggerContext, ExtractedCodeContext, TriggerKind } from "./types";

export type TriggerDecision = {
  shouldRequest: boolean;
  debounceMs: number;
  reason?: string;
};

export type TriggerEvaluateOptions = {
  hotStreakActive?: boolean;
  p95LatencyMs?: number;
};

export class TriggerDetector {
  private lastRequestAt = 0;
  private rejectionCount = 0;
  private backoffUntil = 0;
  private lastContextHash = "";
  private lastAcceptedHash = "";
  private pasteDetectedUntil = 0;
  private rapidTypingUntil = 0;
  private readonly smartThrottle = new SmartThrottle();

  public notePaste(): void {
    this.pasteDetectedUntil = Date.now() + 500;
  }

  public noteRejection(): void {
    this.rejectionCount = Math.min(this.rejectionCount + 1, 5);
    const backoffMs = Math.min(10_000, 2000 * 2 ** (this.rejectionCount - 1));
    this.backoffUntil = Date.now() + backoffMs;
  }

  public noteAcceptance(contextHash: string): void {
    this.rejectionCount = 0;
    this.backoffUntil = 0;
    this.lastAcceptedHash = contextHash;
  }

  public noteKeystroke(): void {
    this.rapidTypingUntil = Date.now() + 120;
    this.smartThrottle.noteKeystroke();
  }

  public evaluate(
    settings: AutocompleteSettings,
    context: ExtractedCodeContext,
    trigger: CompletionTriggerContext,
    options: TriggerEvaluateOptions = {}
  ): TriggerDecision {
    if (!settings.enabled || settings.trigger === "off") {
      return { shouldRequest: false, debounceMs: 0, reason: "disabled" };
    }

    if (Date.now() < this.backoffUntil) {
      return { shouldRequest: false, debounceMs: 0, reason: "backoff" };
    }

    if (context.inComment || context.inString) {
      return { shouldRequest: false, debounceMs: 0, reason: "in_comment_or_string" };
    }

    if (trigger.kind === "manual" || settings.trigger === "manual") {
      if (trigger.kind !== "manual") {
        return { shouldRequest: false, debounceMs: 0, reason: "manual_only" };
      }
      return { shouldRequest: true, debounceMs: 0 };
    }

    if (context.contextHash === this.lastContextHash) {
      return { shouldRequest: false, debounceMs: 0, reason: "unchanged_context" };
    }

    if (
      context.contextHash === this.lastAcceptedHash &&
      Date.now() - this.lastRequestAt < 400
    ) {
      return { shouldRequest: false, debounceMs: 0, reason: "post_accept_cooldown" };
    }

    if (Date.now() < this.rapidTypingUntil && !options.hotStreakActive) {
      const rapidDebounce = this.resolveDebounceMs(settings.debounceMs, false, options);
      return { shouldRequest: false, debounceMs: rapidDebounce, reason: "rapid_typing" };
    }

    const immediate =
      trigger.kind === "paste" ||
      trigger.kind === "immediate" ||
      context.afterDot ||
      context.afterOpenParen ||
      /[=,(]\s*$/.test(context.currentLinePrefix);

    if (trigger.kind === "paste" || Date.now() < this.pasteDetectedUntil) {
      return { shouldRequest: true, debounceMs: 0 };
    }

    const debounceMs = immediate
      ? 0
      : this.resolveDebounceMs(settings.debounceMs, options.hotStreakActive ?? false, options);

    if (trigger.vscodeKind === vscode.InlineCompletionTriggerKind.Automatic) {
      return { shouldRequest: true, debounceMs };
    }

    return { shouldRequest: true, debounceMs };
  }

  private resolveDebounceMs(
    baseMs: number,
    hotStreakActive: boolean,
    options: TriggerEvaluateOptions
  ): number {
    if (hotStreakActive) {
      return Math.min(50, Math.max(0, Math.floor(baseMs * 0.1)));
    }
    return this.smartThrottle.nextDelay(baseMs, options.p95LatencyMs ?? 0);
  }

  public markRequested(contextHash: string): void {
    this.lastContextHash = contextHash;
    this.lastRequestAt = Date.now();
  }
}

export function triggerContextFromVscode(
  context: vscode.InlineCompletionContext,
  manual = false
): CompletionTriggerContext {
  if (manual) {
    return { kind: "manual", vscodeKind: context.triggerKind };
  }
  if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
    return { kind: "manual", vscodeKind: context.triggerKind };
  }
  return { kind: "auto", vscodeKind: context.triggerKind };
}

export function isImmediateTriggerLine(prefix: string): boolean {
  return /[.=(,]\s*$/.test(prefix);
}
