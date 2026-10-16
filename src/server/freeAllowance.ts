import type { UseCase } from "../api/types";
import { FREE_FLASH_MODEL } from "../config/featureModelAssignments";
import { getCatalogModelById, UNKNOWN_MODEL_USD_PER_MILLION_IN, UNKNOWN_MODEL_USD_PER_MILLION_OUT } from "../config/llmModels";

export { FREE_FLASH_MODEL };
/** Shut down June 2026. Spend already recorded under this id still counts. */
export const RETIRED_FREE_FLASH_MODEL = "gemini-2.0-flash";
const FREE_FLASH_MODEL_IDS = new Set([FREE_FLASH_MODEL, RETIRED_FREE_FLASH_MODEL]);

export const FREE_CYCLE_MESSAGE_LIMIT = 15;
export const FREE_CYCLE_USD = 1.75;
export const FREE_WEEK_USD = 7;
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
  sourceClaimReview?: boolean;
  sourceEvidenceRepair?: boolean;
  sourceReviewCostUsd?: number;
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

/** Internal verification/replacement consumes the allowance at actual catalog cost.
 * Flash keeps its existing raw-cost rules; never add the review cost twice. */
export function eventFreeCostUsd(event: FreeAllowanceEvent): number {
  if (isFreeFlashModel(event.model)) return eventFlashCostUsd(event);
  if (event.sourceClaimReview !== true && event.sourceEvidenceRepair !== true) return 0;
  if (typeof event.sourceReviewCostUsd === "number" && Number.isFinite(event.sourceReviewCostUsd)
    && event.sourceReviewCostUsd >= 0) return event.sourceReviewCostUsd;
  const model = getCatalogModelById(event.model);
  return (Math.max(0, event.inputTokens) * (model?.usdPerMillionIn ?? UNKNOWN_MODEL_USD_PER_MILLION_IN)
    + Math.max(0, event.outputTokens) * (model?.usdPerMillionOut ?? UNKNOWN_MODEL_USD_PER_MILLION_OUT)) / 1_000_000;
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
  let cost = sorted.reduce((sum, event) => sum + eventFreeCostUsd(event), 0);
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
    cost -= eventFreeCostUsd(dropped);
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
  /** An already recorded turn may finish its internal calls; cost caps still apply. */
  quotaTurnId?: string;
}): FreeAllowanceTotals {
  const messages = countFreeMessages(input.cycleEvents);
  const cycleUsd = input.cycleEvents.reduce((sum, event) => sum + eventFreeCostUsd(event), 0);
  const weekUsd = input.weekEvents.reduce((sum, event) => sum + eventFreeCostUsd(event), 0);
  const messageRatio = messages / FREE_CYCLE_MESSAGE_LIMIT;
  const cycleUsdRatio = cycleUsd / FREE_CYCLE_USD;
  const weekUsdRatio = weekUsd / FREE_WEEK_USD;
  const usedRatio = Math.min(1, Math.max(0, messageRatio, cycleUsdRatio, weekUsdRatio));
  const continuingTurn = Boolean(input.quotaTurnId?.trim() && input.cycleEvents.some(event =>
    event.countsAsMessage && event.quotaTurnId === input.quotaTurnId!.trim()));
  const cycleBlocked = (messages >= FREE_CYCLE_MESSAGE_LIMIT && !continuingTurn) || cycleUsd >= FREE_CYCLE_USD;
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
