import * as fs from "node:fs";
import { readProjectInstructionsEnabled } from "../config/projectInstructionsConfig";
import type { ProjectInstructionsState } from "../chat/types";
import { attachedAgentsMdLabel } from "./agentsMdAttachmentRecord";
import {
  loadAttachedAgentsMdFile,
  resolveProjectInstructionsGitRoot
} from "./projectInstructionsLoader";

export function resolveProjectInstructionsState(options: {
  activeFile?: string;
  enabled?: boolean;
  workspaceRoots?: string[];
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  attachedAgentsMdPath?: string;
  exists?: (absolutePath: string) => boolean;
  /** When set, AGENTS.md comes from this Use-repo — never a personal upload. */
  useRepoId?: string;
  remoteHasAgentsMd?: boolean;
  canMutate?: boolean;
}): ProjectInstructionsState {
  const enabled = options.enabled ?? readProjectInstructionsEnabled();
  if (!enabled) {
    return { status: "disabled" };
  }

  const exists = options.exists ?? fs.existsSync;
  const gitRoot = resolveProjectInstructionsGitRoot({
    activeFile: options.activeFile,
    resolveAbsolutePath: options.resolveAbsolutePath,
    workspaceRoots: options.workspaceRoots,
    exists
  });
  const canMutate = Boolean(options.canMutate);

  if (options.useRepoId?.trim()) {
    if (options.remoteHasAgentsMd) {
      return {
        status: "loaded",
        gitRoot,
        sources: ["AGENTS.md"],
        hasAgentsMd: true,
        source: "repo",
        canMutate: false
      };
    }
    return {
      status: "missing",
      gitRoot,
      hasAgentsMd: false,
      source: "repo",
      canMutate: false
    };
  }

  const attachedPath = options.attachedAgentsMdPath?.trim();
  const attachedFile = attachedPath && exists(attachedPath) ? loadAttachedAgentsMdFile(attachedPath) : undefined;
  const attachedLabel = attachedFile ? attachedAgentsMdLabel(attachedPath) : undefined;

  if (attachedFile && attachedLabel) {
    return {
      status: "loaded",
      gitRoot,
      sources: [attachedFile.path],
      hasAgentsMd: true,
      attachedAgentsMdLabel: attachedLabel,
      source: "attached",
      canMutate
    };
  }

  if (!gitRoot) {
    return { status: "no_git", hasAgentsMd: false, source: "attached", canMutate };
  }

  return {
    status: "missing",
    gitRoot,
    hasAgentsMd: false,
    source: "attached",
    canMutate
  };
}
