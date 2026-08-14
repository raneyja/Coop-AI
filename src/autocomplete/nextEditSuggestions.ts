import { SmartThrottle } from "./smartThrottle";

export const NES_CONTEXT_SOURCES = ["buffer", "graph-api"] as const;
export type NesContextSource = (typeof NES_CONTEXT_SOURCES)[number];

export type PredictedNextEdit = {
  line: number;
  character: number;
  reason: "next-sibling-identifier" | "next-incomplete-line" | "after-accept-line";
};

export type NesPlan =
  | { kind: "skip"; reason: "disabled" | "not_after_accept" | "throttled" | "in_flight" | "no_location" }
  | {
      kind: "nes";
      prediction: PredictedNextEdit;
      contextSources: readonly NesContextSource[];
    };

const RAPID_TYPING_CPS = 8;
const RAPID_KEYSTROKE_BURST = 8;
const SKIP_BASE_MS = 400;

export function isNextEditSuggestionsEnabled(settings: {
  nextEditSuggestions?: boolean;
}): boolean {
  return settings.nextEditSuggestions === true;
}

export function shouldIssueNesRequest(input: {
  nesEnabled: boolean;
  afterTabAccept: boolean;
  throttleBlocked: boolean;
  alreadyInFlight: boolean;
}): boolean {
  return (
    input.nesEnabled &&
    input.afterTabAccept &&
    !input.throttleBlocked &&
    !input.alreadyInFlight
  );
}

export function resolveNesContextSources(): readonly NesContextSource[] {
  return NES_CONTEXT_SOURCES;
}

export function nesAllowsDiskWalk(): boolean {
  return false;
}

/**
 * NES never rides the typing → ghost path. Extra network happens only after
 * Tab-accept when the setting is on, so base p50/p95 stay unchanged.
 */
export function nesTouchesBaseCompletionPath(_nesEnabled: boolean): boolean {
  return false;
}

export function extractPrimaryIdentifier(insertedText: string): string | undefined {
  const match = insertedText.match(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/);
  return match?.[1];
}

export function predictNextEditLocation(
  lines: readonly string[],
  accept: { line: number; character: number; insertedText?: string }
): PredictedNextEdit | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  const acceptLine = Math.max(0, Math.min(accept.line, lines.length - 1));
  const ident = extractPrimaryIdentifier(accept.insertedText ?? "");

  if (ident) {
    for (let i = acceptLine + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (/^\s*(\/\/|\*)/.test(line)) {
        continue;
      }
      const idx = line.indexOf(ident);
      if (idx >= 0) {
        return {
          line: i,
          character: Math.min(line.length, idx + ident.length),
          reason: "next-sibling-identifier"
        };
      }
    }
  }

  for (let i = acceptLine + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line)) {
      continue;
    }
    if (/[{[(]\s*$/.test(line) || /TODO|FIXME|\.\.\./.test(line) || /,\s*$/.test(line)) {
      return {
        line: i,
        character: line.length,
        reason: "next-incomplete-line"
      };
    }
  }

  for (let i = acceptLine + 1; i < Math.min(lines.length, acceptLine + 8); i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line) || /^\s*[}\])];?\s*$/.test(line)) {
      continue;
    }
    return {
      line: i,
      character: line.length,
      reason: "after-accept-line"
    };
  }

  const fallbackLine = Math.min(acceptLine + 1, lines.length - 1);
  const fallback = lines[fallbackLine] ?? "";
  const indent = fallback.match(/^\s*/)?.[0].length ?? 0;
  return {
    line: fallbackLine,
    character: fallbackLine === acceptLine ? Math.max(accept.character, indent) : indent,
    reason: "after-accept-line"
  };
}

export function planNesAfterAccept(input: {
  nesEnabled: boolean;
  lines: readonly string[];
  cursor: { line: number; character: number };
  insertedText?: string;
  throttleBlocked?: boolean;
  inFlight?: boolean;
}): NesPlan {
  if (!input.nesEnabled) {
    return { kind: "skip", reason: "disabled" };
  }
  if (input.throttleBlocked) {
    return { kind: "skip", reason: "throttled" };
  }
  if (input.inFlight) {
    return { kind: "skip", reason: "in_flight" };
  }
  const prediction = predictNextEditLocation(input.lines, {
    line: input.cursor.line,
    character: input.cursor.character,
    insertedText: input.insertedText
  });
  if (!prediction) {
    return { kind: "skip", reason: "no_location" };
  }
  return {
    kind: "nes",
    prediction,
    contextSources: resolveNesContextSources()
  };
}

export function nesGhostRange(prediction: PredictedNextEdit): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: prediction.line, character: prediction.character },
    end: { line: prediction.line, character: prediction.character }
  };
}

/**
 * After Tab-accept (opt-in), arm one NES request at a predicted buffer location.
 * Does not walk disk. Cancels on rapid typing so we do not storm the model.
 */
export class NextEditController {
  private armed = false;
  private inFlight = false;
  private requestCount = 0;
  private rejectCount = 0;
  private lastShownWasNes = false;
  private pending: PredictedNextEdit | undefined;
  private lastInsertedText = "";
  private skipBaseUntil = 0;
  private keystrokesSinceArm = 0;
  private readonly throttle = new SmartThrottle();

  public armAfterTabAccept(insertedText?: string): void {
    this.armed = true;
    this.lastInsertedText = insertedText ?? "";
    this.lastShownWasNes = false;
    this.keystrokesSinceArm = 0;
  }

  public isArmed(): boolean {
    return this.armed;
  }

  public isInFlight(): boolean {
    return this.inFlight;
  }

  public noteKeystroke(): void {
    this.throttle.noteKeystroke();
    this.keystrokesSinceArm += 1;
    if (this.isThrottleBlocked() && this.armed && !this.inFlight) {
      this.cancel();
    }
  }

  public isThrottleBlocked(): boolean {
    return (
      this.keystrokesSinceArm >= RAPID_KEYSTROKE_BURST ||
      this.throttle.typingSpeedCps() >= RAPID_TYPING_CPS
    );
  }

  public shouldRequest(nesEnabled: boolean): boolean {
    return shouldIssueNesRequest({
      nesEnabled,
      afterTabAccept: this.armed,
      throttleBlocked: this.isThrottleBlocked(),
      alreadyInFlight: this.inFlight
    });
  }

  public shouldSkipBasePath(): boolean {
    return this.inFlight || Date.now() < this.skipBaseUntil;
  }

  public beginRequest(prediction: PredictedNextEdit): void {
    this.inFlight = true;
    this.requestCount += 1;
    this.pending = prediction;
    this.armed = false;
    this.skipBaseUntil = Date.now() + SKIP_BASE_MS;
  }

  public finishRequest(): void {
    this.inFlight = false;
  }

  public markShown(): void {
    this.lastShownWasNes = true;
  }

  public markRejected(): void {
    if (this.lastShownWasNes) {
      this.rejectCount += 1;
    }
    this.cancel();
  }

  public cancel(): void {
    this.armed = false;
    this.pending = undefined;
    this.inFlight = false;
    this.lastShownWasNes = false;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  public getRejectCount(): number {
    return this.rejectCount;
  }

  public getPending(): PredictedNextEdit | undefined {
    return this.pending;
  }

  public wasLastShownNes(): boolean {
    return this.lastShownWasNes;
  }

  public getLastInsertedText(): string {
    return this.lastInsertedText;
  }
}
