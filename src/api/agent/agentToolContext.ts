import type { IndexBackend } from "../../indexing/indexBackend";

export type AgentToolContext = {
  indexBackend: IndexBackend;
  resolveAbsolutePath: (relativePath: string) => string | undefined;
};
