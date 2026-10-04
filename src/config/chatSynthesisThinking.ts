import { remainingContextGatherBudgetMs } from "./responseDeadline";

/** Finish gathered read-only reports without another reasoning phase when the
 * shared gather allowance is spent. This changes neither the selected model nor
 * the turn's cancellation/lifetime; it still streams a complete grounded answer.
 */
export function shouldEnableSynthesisThinking(options: {
  quickAction?: string;
  startedAt: number;
  now?: number;
}): boolean {
  if (options.quickAction !== "knowledge-gaps" && options.quickAction !== "understand-repo") {
    return true;
  }
  return remainingContextGatherBudgetMs(options.startedAt, options.now) > 0;
}
