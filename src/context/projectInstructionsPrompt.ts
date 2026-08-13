import { loadProjectInstructionsCached, loadRemoteProjectInstructionsCached } from "./projectInstructionsCache";
import {
  formatProjectInstructionsBlock,
  joinInstructionBlocks
} from "./projectInstructionsLoader";
import { formatVisibleMemoryBlock, sourcedMemoryFacts } from "./visibleMemory";
import type { VisibleMemoryFact } from "../chat/types";

export type BuildProjectInstructionsPromptOptions = {
  enabled: boolean;
  useRepo?: {
    repoId: string;
    branch?: string;
    version?: string;
  };
  localGitRoot?: string;
  activeFile?: string;
  attachedAgentsMdPath?: string;
  remainingGatherMs: number;
  readRemoteFile?: (path: string) => Promise<string | undefined>;
  memoryFacts?: VisibleMemoryFact[];
};

/**
 * Silent system-prompt block for AGENTS.md + sourced memory.
 * Remote Use-repo never reads a local clone (Zero-Clone / D-P4).
 */
export async function buildProjectInstructionsPromptBlock(
  options: BuildProjectInstructionsPromptOptions
): Promise<string | undefined> {
  if (!options.enabled) {
    return undefined;
  }

  const repoId = options.useRepo?.repoId.trim();
  const memoryBlock = formatVisibleMemoryBlock(sourcedMemoryFacts(options.memoryFacts ?? [], repoId));

  if (repoId) {
    const files = options.readRemoteFile
      ? await loadRemoteProjectInstructionsCached({
          repoId,
          branch: options.useRepo?.branch,
          version: options.useRepo?.version,
          timeoutMs: options.remainingGatherMs,
          readFile: options.readRemoteFile
        })
      : [];
    return joinInstructionBlocks(formatProjectInstructionsBlock(files), memoryBlock);
  }

  if (!options.localGitRoot) {
    return memoryBlock || undefined;
  }

  const localFiles = loadProjectInstructionsCached({
    enabled: true,
    gitRoot: options.localGitRoot,
    activeFile: options.activeFile,
    attachedAgentsMdPath: options.attachedAgentsMdPath
  });
  return joinInstructionBlocks(formatProjectInstructionsBlock(localFiles), memoryBlock);
}
