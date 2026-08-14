/**
 * When the agent loop calls propose_patch, the SEARCH/REPLACE lands in
 * agentTools — not in the chat answer. The Patch card is built from the
 * answer text, so without this bridge a change request can hunt, propose,
 * and still never show Apply.
 */

export function extractAgentProposedPatchText(bundle: unknown): string | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const patch = (entry as { data?: { agentTools?: { propose_patch?: { patchText?: unknown } } } })
      .data?.agentTools?.propose_patch;
    if (!patch || typeof patch !== "object") {
      continue;
    }
    const text = typeof patch.patchText === "string" ? patch.patchText.trim() : "";
    if (text.length > 0 && /<<<<<<< SEARCH/.test(text)) {
      return text;
    }
  }
  return undefined;
}

/** Prefer an already-emitted answer patch; otherwise append the agent one. */
export function mergeAnswerWithAgentPatch(content: string, patchText: string | undefined): string {
  if (!patchText?.trim()) {
    return content;
  }
  if (/<<<<<<< SEARCH/.test(content)) {
    return content;
  }
  const body = content.trimEnd();
  return body.length > 0 ? `${body}\n\n${patchText.trim()}` : patchText.trim();
}
