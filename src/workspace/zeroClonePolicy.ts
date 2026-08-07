/**
 * Zero-Clone product law.
 *
 * Coop uses **indexed remote repositories**. It must never read a local clone
 * or VS Code workspace folder for repository intelligence:
 * chat gather, quick actions, slash commands, agent tools, Blast dependents,
 * semantic hydrate, or IndexedRepoWorkspace file bodies.
 *
 * File bodies are fetched on demand from the code host / index APIs.
 * The temporary Deep-Index clone is deleted after indexing — it is not a
 * durable content source.
 *
 * Not covered here (not “scan the repo from disk”):
 * - Applying a patch into an already-open editor buffer
 * - AGENTS.md / prompt-library file pickers
 * - Autocomplete on the active editor buffer
 * - Explicit outside-repo uploads (`fileSource: "external"`)
 */

export const ZERO_CLONE = true as const;

/** Always false while Zero-Clone is the product law. */
export function mayReadLocalRepoDiskForIntelligence(): boolean {
  return !ZERO_CLONE;
}
