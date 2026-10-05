import { remainingContextGatherBudgetMs } from "./responseDeadline";

/** Finish gathered read-only reports without another reasoning phase when the
 * shared gather allowance is spent. This changes neither the selected model nor
 * the turn's cancellation/lifetime; it still streams a complete grounded answer.
 */
export function shouldEnableSynthesisThinking(options: {
  quickAction?: string;
  startedAt: number;
  now?: number;
  sourceFacts?: {
    userFocus?: string;
    entryFiles?: Array<{ path: string; content?: string; truncated?: boolean }>;
  };
}): boolean {
  if (options.quickAction !== "knowledge-gaps" && options.quickAction !== "understand-repo") {
    return true;
  }
  if (options.quickAction === "understand-repo" && hasBoundedSourceResultAsk(options.sourceFacts)) {
    return false;
  }
  return remainingContextGatherBudgetMs(options.startedAt, options.now) > 0;
}

/** Direct output questions with complete named source already gathered can be
 * answered in the normal model stream, without a second hidden thinking phase.
 * Broad comprehension and missing/truncated source retain the existing policy.
 */
function hasBoundedSourceResultAsk(facts: {
  userFocus?: string;
  entryFiles?: Array<{ path: string; content?: string; truncated?: boolean }>;
} | undefined): boolean {
  const ask = facts?.userFocus?.trim();
  if (!ask || !/\b(?:exact results?|return values?|what (?:does|will) .{0,80}return)\b/i.test(ask)) return false;
  if (/\b(?:architectur\w*|redesign|refactor|trade[- ]?offs?|prove|security|performance|optimi[sz]\w*)\b/i.test(ask)) return false;
  const askedPaths = [...new Set(ask.match(/\b(?:[\w.-]+\/)*[\w.-]+\.[a-zA-Z][a-zA-Z0-9]{0,9}\b/g) ?? [])];
  if (askedPaths.length === 0 || askedPaths.length > 2) return false;
  // The summary may also contain README or caller evidence. Only the explicitly
  // asked files establish this bounded source task; none may be absent or partial.
  return askedPaths.every((path) => facts?.entryFiles?.some((file) =>
    file.path.replace(/^\.\//, "") === path && !file.truncated && Boolean(file.content?.trim())
  ));
}
