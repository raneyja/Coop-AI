import type { UseCase } from "../api/types";
import { FREE_FLASH_MODEL } from "../config/featureModelAssignments";

export { FREE_FLASH_MODEL };
/** Shut down June 2026. Spend already recorded under this id still counts. */
export const RETIRED_FREE_FLASH_MODEL = "gemini-2.0-flash";
const FREE_FLASH_MODEL_IDS = new Set([FREE_FLASH_MODEL, RETIRED_FREE_FLASH_MODEL]);

export const FREE_CYCLE_MESSAGE_LIMIT = 20;
export const FREE_CYCLE_USD = 2;
export const FREE_WEEK_USD = 8;
export const FREE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FREE_NEAR_LIMIT_RATIO = 0.8;
export const FREE_FLASH_USD_PER_MILLION_IN = 0.3;
export const FREE_FLASH_USD_PER_MILLION_OUT = 2.5;

export type FreeBlockedWindow = "cycle" | "week";

export type FreeAllowanceEvent = {
  createdAt: Date;
  inputTokens: number;
  outputTokens: number;
  model: string;
  useCase?: string;
  quotaTurnId?: string;
  countsAsMessage: boolean;
  flashCostUsd?: number;
};

export type FreeAllowanceTotals = {
  messages: number;
  cycleUsd: number;
  weekUsd: number;
  usedRatio: number;
  exhausted: boolean;
  nearLimit: boolean;
  blockedWindow?: FreeBlockedWindow;
  resetsAt: Date;
};

/** Gemini 2.5 Flash list cost. No 1.5× weight and no per-call 1-cent floor. */
export function flashListCostUsd(inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  return (input / 1_000_000) * FREE_FLASH_USD_PER_MILLION_IN + (output / 1_000_000) * FREE_FLASH_USD_PER_MILLION_OUT;
}

export function isFreeFlashModel(model: string | undefined): boolean {
  return FREE_FLASH_MODEL_IDS.has((model ?? "").trim());
}

export function countsAsFreeQuotaMessage(useCase: UseCase | string | undefined): boolean {
  return (
    useCase !== "intent_suggest" &&
    useCase !== "evidence_preview" &&
    useCase !== "pr_summary" &&
    useCase !== "inline_completion"
  );
}

export function eventFlashCostUsd(event: FreeAllowanceEvent): number {
  if (!isFreeFlashModel(event.model)) {
    return 0;
  }
  if (typeof event.flashCostUsd === "number" && Number.isFinite(event.flashCostUsd)) {
    return Math.max(0, event.flashCostUsd);
  }
  return flashListCostUsd(event.inputTokens, event.outputTokens);
}

export function countFreeMessages(events: FreeAllowanceEvent[]): number {
  const turns = new Set<string>();
  let singles = 0;
  for (const event of events) {
    if (!event.countsAsMessage) {
      continue;
    }
    const turnId = event.quotaTurnId?.trim();
    if (turnId) {
      turns.add(turnId);
    } else {
      singles += 1;
    }
  }
  return turns.size + singles;
}

export function currentWeekWindow(anchor: Date, now: Date): { from: Date; to: Date } {
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed < 0) {
    return { from: anchor, to: new Date(anchor.getTime() + FREE_WEEK_MS) };
  }
  const index = Math.floor(elapsed / FREE_WEEK_MS);
  const from = new Date(anchor.getTime() + index * FREE_WEEK_MS);
  return { from, to: new Date(from.getTime() + FREE_WEEK_MS) };
}

export function cycleResumeAt(
  events: FreeAllowanceEvent[],
  windowMs: number,
  now: Date
): Date {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let messages = countFreeMessages(sorted);
  let cost = sorted.reduce((sum, event) => sum + eventFlashCostUsd(event), 0);
  if (messages < FREE_CYCLE_MESSAGE_LIMIT && cost < FREE_CYCLE_USD) {
    const oldest = sorted[0]?.createdAt ?? now;
    return new Date(oldest.getTime() + windowMs);
  }

  const remaining = [...sorted];
  let resume = now;
  while (remaining.length > 0 && (countFreeMessages(remaining) >= FREE_CYCLE_MESSAGE_LIMIT || cost >= FREE_CYCLE_USD)) {
    const dropped = remaining.shift();
    if (!dropped) {
      break;
    }
    cost -= eventFlashCostUsd(dropped);
    resume = new Date(dropped.createdAt.getTime() + windowMs);
  }
  return resume.getTime() < now.getTime() ? now : resume;
}

export function summarizeFreeAllowance(input: {
  cycleEvents: FreeAllowanceEvent[];
  weekEvents: FreeAllowanceEvent[];
  weekEnd: Date;
  windowMs: number;
  now: Date;
}): FreeAllowanceTotals {
  const messages = countFreeMessages(input.cycleEvents);
  const cycleUsd = input.cycleEvents.reduce((sum, event) => sum + eventFlashCostUsd(event), 0);
  const weekUsd = input.weekEvents.reduce((sum, event) => sum + eventFlashCostUsd(event), 0);
  const messageRatio = messages / FREE_CYCLE_MESSAGE_LIMIT;
  const cycleUsdRatio = cycleUsd / FREE_CYCLE_USD;
  const weekUsdRatio = weekUsd / FREE_WEEK_USD;
  const usedRatio = Math.min(1, Math.max(0, messageRatio, cycleUsdRatio, weekUsdRatio));
  const cycleBlocked = messages >= FREE_CYCLE_MESSAGE_LIMIT || cycleUsd >= FREE_CYCLE_USD;
  const weekBlocked = weekUsd >= FREE_WEEK_USD;
  const exhausted = cycleBlocked || weekBlocked;
  const blockedWindow: FreeBlockedWindow | undefined = weekBlocked ? "week" : cycleBlocked ? "cycle" : undefined;
  const cycleResume = cycleResumeAt(input.cycleEvents, input.windowMs, input.now);
  const resetsAt = blockedWindow === "week" ? input.weekEnd : cycleResume;
  return {
    messages,
    cycleUsd,
    weekUsd,
    usedRatio,
    exhausted,
    nearLimit: !exhausted && usedRatio >= FREE_NEAR_LIMIT_RATIO,
    blockedWindow,
    resetsAt
  };
}
