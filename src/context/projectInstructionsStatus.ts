import { readProjectInstructionsEnabled } from "../config/projectInstructionsConfig";
import type { ProjectInstructionsState } from "../chat/types";
import { attachedAgentsMdLabel } from "./agentsMdAttachmentStore";
import {
  resolveProjectInstructionsGitRoot,
  type ProjectInstructionFile
} from "./projectInstructionsLoader";
import { loadProjectInstructionsCached } from "./projectInstructionsCache";

export function resolveProjectInstructionsState(options: {
  activeFile?: string;
  enabled?: boolean;
  workspaceRoots?: string[];
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  attachedAgentsMdPath?: string;
}): ProjectInstructionsState {
  const enabled = options.enabled ?? readProjectInstructionsEnabled();
  if (!enabled) {
    return { status: "disabled" };
  }

  const attachedLabel = attachedAgentsMdLabel(options.attachedAgentsMdPath);
  const gitRoot = resolveProjectInstructionsGitRoot({
    activeFile: options.activeFile,
    resolveAbsolutePath: options.resolveAbsolutePath,
    workspaceRoots: options.workspaceRoots
  });

  const files = gitRoot
    ? loadProjectInstructionsCached({
        enabled: true,
        gitRoot,
        activeFile: options.activeFile,
        attachedAgentsMdPath: options.attachedAgentsMdPath
      })
    : ([] as ProjectInstructionFile[]);
  const sources = files.map((file) => formatInstructionSourceLabel(file));
  const hasRepoAgentsMd = sources.some(isAgentsMdPath);
  const hasAgentsMd = hasRepoAgentsMd || Boolean(attachedLabel);

  if (!gitRoot && !hasAgentsMd) {
    return { status: "no_git", hasAgentsMd: false, attachedAgentsMdLabel: attachedLabel };
  }

  if (!files.length && !attachedLabel) {
    return {
      status: "missing",
      gitRoot,
      hasAgentsMd: false,
      attachedAgentsMdLabel: attachedLabel
    };
  }

  return {
    status: "loaded",
    gitRoot,
    sources,
    hasAgentsMd,
    attachedAgentsMdLabel: attachedLabel
  };
}

export function formatInstructionSourceLabel(file: ProjectInstructionFile): string {
  return file.path;
}

function isAgentsMdPath(path: string): boolean {
  return path === "AGENTS.md" || path.endsWith("/AGENTS.md") || path.toLowerCase().endsWith("agents.md");
}
