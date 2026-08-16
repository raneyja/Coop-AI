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
    const patch = (entry as {
      data?: { agentTools?: { propose_patch?: { ok?: unknown; patchText?: unknown } } };
    }).data?.agentTools?.propose_patch;
    if (!patch || typeof patch !== "object") {
      continue;
    }
    // Rejected / unanchored proposals must never reach the Patch card.
    if (patch.ok === false) {
      continue;
    }
    const text = typeof patch.patchText === "string" ? patch.patchText.trim() : "";
    if (text.length > 0 && /<<<<<<< SEARCH/.test(text)) {
      return text;
    }
  }
  return undefined;
}

/**
 * Prefer the tool-validated agent patch over anything the synthesizer invented.
 * Dogfood miss: model patched auth-forms while propose_patch had (or should have
 * had) the real middleware — Apply showed SEARCH not found.
 */
export function mergeAnswerWithAgentPatch(content: string, patchText: string | undefined): string {
  if (!patchText?.trim()) {
    return content;
  }
  const agent = patchText.trim();
  const prose = stripEmittedPatchBlocks(content).trimEnd();
  return prose.length > 0 ? `${prose}\n\n${agent}` : agent;
}

/** Remove File:/patch fences and bare SEARCH/REPLACE blocks from model prose. */
export function stripEmittedPatchBlocks(content: string): string {
  let text = content;
  text = text.replace(
    /(?:^|\n)File:\s*[^\n]+\n+```(?:patch)?\n[\s\S]*?<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE[\s\S]*?```/gi,
    "\n"
  );
  text = text.replace(
    /```(?:patch)?\n[\s\S]*?<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE[\s\S]*?```/gi,
    "\n"
  );
  text = text.replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/gi, "\n");
  return text.replace(/\n{3,}/g, "\n\n");
}
