import type { CodeHostProviderPreference, PatchCardState } from "../chat/types";
import type { FileUndoSnapshot } from "./patchApplier";
import type { ParsedPatchSet } from "./patchParser";

/** Cap for one Apply session. Split larger edits rather than unbounded patch sets. */
export { PATCH_SESSION_MAX_FILES } from "./patchParser";

/**
 * Use-repo identity for a patch Apply session.
 * Phase C consumes this to open a PR; Wave 2 B only uses it for remote auto-open.
 */
export type PatchSessionRepo = {
  owner: string;
  repo: string;
  provider: CodeHostProviderPreference;
  branch?: string;
};

/**
 * Contract for one Patch card session (B apply/undo + reserved C Create PR slot).
 *
 * - SEARCH/REPLACE only; Apply never silently writes for intelligence.
 * - One session; per-file / per-hunk accept, reject, and undo.
 * - `canCreatePr` stays false in Wave 2 B. C flips it after a successful Apply.
 */
export type PatchSession = {
  messageTimestamp: number;
  patches: ParsedPatchSet;
  card: PatchCardState;
  repo?: PatchSessionRepo;
  undo?: FileUndoSnapshot[];
  /** Reserved for Phase C. Default false — do not enable Create PR in Wave 2 B. */
  canCreatePr: boolean;
};

export function remoteOpenUnsupportedMessage(
  relativePath: string,
  provider: CodeHostProviderPreference
): string {
  const host = provider === "gitlab" ? "GitLab" : provider === "bitbucket" ? "Bitbucket" : provider;
  return (
    `Cannot auto-open ${relativePath} on ${host}. ` +
    "Remote Apply without a clone is GitHub only — open the file in the editor or clone the repository, then Apply again."
  );
}

export function githubRemoteOpenFailedMessage(relativePath: string): string {
  return (
    `Could not open ${relativePath} from GitHub. ` +
    "Install GitHub Repositories, or open the file in the editor, then Apply again."
  );
}

export function missingPatchTargetMessage(relativePath: string): string {
  return `Could not resolve file: ${relativePath}. Open it in the editor (remote tabs work), then Apply again.`;
}
