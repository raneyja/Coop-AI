import { DEFAULT_INTENT_CONFIG, IntentDebounceConfig } from "../config/intentConfig";
import { IntentEvent, UserIntent, isBlockedIntent } from "./intentDetector";

export type DebounceStatus = "executed" | "scheduled" | "cancelled" | "blocked";

export type DebounceResult<T> = {
  status: DebounceStatus;
  event: IntentEvent;
  value?: T;
};

export type DebouncedExecutor<T> = (event: IntentEvent) => Promise<T> | T;

type PendingRequest<T> = {
  event: IntentEvent;
  timer: ReturnType<typeof setTimeout>;
  execute: DebouncedExecutor<T>;
  resolve: (result: DebounceResult<T>) => void;
  reject: (error: unknown) => void;
};

export type IntentDebouncerOptions = {
  rules?: Partial<IntentDebounceConfig>;
  keyFactory?: (event: IntentEvent) => string;
};

export class IntentDebouncer {
  private readonly rules: IntentDebounceConfig;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
  private readonly keyFactory: (event: IntentEvent) => string;

  public constructor(options: IntentDebouncerOptions = {}) {
    this.rules = {
      ...DEFAULT_INTENT_CONFIG.debounceRules,
      ...options.rules
    };
    this.keyFactory = options.keyFactory ?? defaultDebounceKey;
  }

  public debounce<T>(event: IntentEvent, execute: DebouncedExecutor<T>): Promise<DebounceResult<T>> {
    const delay = this.delayFor(event.intent);
    if (isBlockedIntent(event.intent) || !Number.isFinite(delay)) {
      return Promise.resolve({ status: "blocked", event });
    }

    const key = this.keyFactory(event);
    this.cancelKey(key);

    if (delay <= 0) {
      return this.executeNow(event, execute);
    }

    return new Promise<DebounceResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(key);
        void this.executeNow(event, execute)
          .then((result) => resolve({ ...result, status: "scheduled" }))
          .catch(reject);
      }, delay);

      this.pendingRequests.set(key, {
        event,
        timer,
        execute: execute as DebouncedExecutor<unknown>,
        resolve: resolve as (result: DebounceResult<unknown>) => void,
        reject
      });
    });
  }

  public cancel(event: IntentEvent): boolean {
    return this.cancelKey(this.keyFactory(event));
  }

  public cancelAll(): void {
    for (const key of this.pendingRequests.keys()) {
      this.cancelKey(key);
    }
  }

  public async flush(): Promise<DebounceResult<unknown>[]> {
    const pending = [...this.pendingRequests.entries()];
    this.pendingRequests.clear();
    const results: Array<Promise<DebounceResult<unknown>>> = [];
    for (const [, request] of pending) {
      clearTimeout(request.timer);
      results.push(
        this.executeNow(request.event, request.execute)
          .then((result) => ({ ...result, status: "scheduled" as const }))
          .catch((error) => {
            request.reject(error);
            throw error;
          })
      );
    }
    return Promise.all(results);
  }

  public dispose(): void {
    this.cancelAll();
  }

  public pendingCount(): number {
    return this.pendingRequests.size;
  }

  public updateRules(rules: Partial<IntentDebounceConfig>): void {
    Object.assign(this.rules, rules);
  }

  public delayFor(intent: UserIntent): number {
    switch (intent) {
      case UserIntent.QUICK_ACTION_CLICKED:
        return this.rules.quickActionClicked;
      case UserIntent.MANUAL_CHAT_SUBMIT:
        return this.rules.manualChatSubmit;
      case UserIntent.HOTKEY_TRIGGERED:
        return this.rules.hotkeyTriggered;
      case UserIntent.FILE_SWITCHED:
        return this.rules.fileSwitched;
      case UserIntent.SELECTION_CHANGE:
        return this.rules.selectionChange;
      case UserIntent.EDITOR_OPENED:
        return this.rules.editorOpened;
      case UserIntent.KEYSTROKE:
        return this.rules.keystroke;
      case UserIntent.MOUSE_HOVER:
        return this.rules.mouseHover;
      default:
        return 0;
    }
  }

  private async executeNow<T>(event: IntentEvent, execute: DebouncedExecutor<T>): Promise<DebounceResult<T>> {
    const value = await execute(event);
    return { status: "executed", event, value };
  }

  private cancelKey(key: string): boolean {
    const existing = this.pendingRequests.get(key);
    if (!existing) {
      return false;
    }
    clearTimeout(existing.timer);
    this.pendingRequests.delete(key);
    existing.resolve({ status: "cancelled", event: existing.event });
    return true;
  }
}

export function defaultDebounceKey(event: IntentEvent): string {
  const repo = event.context.repoId ?? "repo";
  // Editor snaps share one key per intent+repo so A→B cancels pending A.
  // Including `file` let a late FILE_SWITCHED(A) overwrite a good snap to B.
  if (
    event.intent === UserIntent.FILE_SWITCHED ||
    event.intent === UserIntent.EDITOR_OPENED ||
    event.intent === UserIntent.SELECTION_CHANGE
  ) {
    return `${event.intent}:${repo}`;
  }
  const file = event.context.file ?? "workspace";
  return `${event.intent}:${repo}:${file}`;
}

export function createDebounceRules(overrides: Partial<IntentDebounceConfig> = {}): IntentDebounceConfig {
  return {
    ...DEFAULT_INTENT_CONFIG.debounceRules,
    ...overrides
  };
}
