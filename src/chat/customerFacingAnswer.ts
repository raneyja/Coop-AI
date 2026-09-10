import { stripEmittedPatchBlocks } from "./agentProposedPatch";

/** Shown only when there is no answer to keep — never appended to one. */
export const CUSTOMER_EMPTY_HUNT_ANSWER =
  "I couldn't find that in this repo. Try a more specific name, or open the file.";

/**
 * Chat bubbles are customer-facing. Hunt/index/patch internals belong in
 * activity, never concatenated onto an answer that already shipped.
 *
 * If the turn produced prose, that prose is the product. Do not append
 * "couldn't produce an apply-able patch" / "use /edit" / "the index".
 */
export function customerFacingAgentAnswer(options: {
  content: string;
  hasApplyPatch: boolean;
}): string {
  if (options.hasApplyPatch) {
    return options.content;
  }
  return stripEmittedPatchBlocks(options.content).trim();
}
