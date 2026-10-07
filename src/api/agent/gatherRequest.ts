import { abortablePromise, remainingContextGatherBudgetMs } from "../../config/responseDeadline";
import type { AgentToolContext } from "./agentToolContext";

/** Stop waiting for gather at the shared soft budget; never abort the answer. */
export async function gatherRequest<T>(
  ctx: AgentToolContext,
  stage: string,
  request: () => Promise<T>,
  unavailable: T,
  options?: { reserveMs?: number; deadlineAt?: number }
): Promise<T> {
  if (ctx.searchSignal?.aborted) return unavailable;
  if (ctx.gatherStartedAt === undefined) return request();
  const remainingMs = options?.deadlineAt !== undefined
    ? Math.max(0, options.deadlineAt - Date.now())
    : Math.max(
        0,
        remainingContextGatherBudgetMs(ctx.gatherStartedAt) - (options?.reserveMs ?? 0)
      );
  if (remainingMs <= 0) return unavailable;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = request();
    const result = Promise.race([
      pending,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          ctx.onDiagnostic?.({ stage: "gather-handoff", waitingStage: stage });
          resolve(unavailable);
        }, remainingMs);
      })
    ]);
    return await (ctx.searchSignal ? abortablePromise(result, ctx.searchSignal) : result);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
