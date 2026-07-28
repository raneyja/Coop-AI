import type { RepoContext, UserPreferences } from "../chat/types";

type BranchPrefs = Pick<UserPreferences, "branch">;

/**
 * Branch for editor/context snaps.
 *
 * Sticky Use-repo / workspace branch must win over Settings `coopAI.defaultBranch`
 * (often stale `main`). Prefs only fill in when the session has no branch yet.
 */
export function branchForEditorContext(
  previous: Pick<RepoContext, "branch">,
  preferences: BranchPrefs
): string | undefined {
  return previous.branch?.trim() || preferences.branch?.trim() || undefined;
}
