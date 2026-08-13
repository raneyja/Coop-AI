import type { AgentToolName } from "../agentTypes";
import type { AgentToolContext } from "../agentToolContext";
import { handleReadFile } from "./readFile";
import { handleSearchCode } from "./searchCode";
import { handleListDirectory } from "./listDirectory";
import { handleGitBlame } from "./gitBlame";
import { handleProposePatch } from "./proposePatch";

export type AgentToolHandler = (args: Record<string, unknown>) => Promise<string>;

export function createAgentToolRegistry(
  ctx: AgentToolContext
): Partial<Record<AgentToolName, AgentToolHandler>> {
  return {
    read_file: (args) => handleReadFile(ctx, args),
    search_code: (args) => handleSearchCode(ctx, args),
    list_directory: (args) => handleListDirectory(ctx, args),
    git_blame: (args) => handleGitBlame(ctx, args),
    propose_patch: (args) => handleProposePatch(args)
  };
}
