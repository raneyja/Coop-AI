import { readProjectInstructionsEnabled } from "../config/projectInstructionsConfig";
import type { ProjectInstructionsState } from "../chat/types";
import { attachedAgentsMdLabel } from "./agentsMdAttachmentStore";
import {
  loadProjectInstructions,
  resolveProjectInstructionsGitRoot,
  type ProjectInstructionFile
} from "./projectInstructionsLoader";

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

  const loaded = gitRoot
    ? loadProjectInstructions({
        gitRoot,
        activeFile: options.activeFile
      })
    : { files: [] as ProjectInstructionFile[], sourcePaths: [] as string[] };
  const sources = loaded.files.map((file) => formatInstructionSourceLabel(file));
  const hasAgentsMd = sources.some(isAgentsMdPath);

  if (!gitRoot && !hasAgentsMd) {
    return { status: "no_git", hasAgentsMd: false, attachedAgentsMdLabel: attachedLabel };
  }

  if (!loaded.files.length) {
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
