import { parseCodeHostProvider, type CodeHostProvider } from "./types";

export type EvidenceCodeHost = CodeHostProvider;

const CODE_HOST_NAMES: Record<EvidenceCodeHost, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

/**
 * Resolve the active Use-repo code host for evidence UI and source citations.
 * Prefer the open repo's provider — never assume GitHub.
 */
export function resolveEvidenceCodeHost(provider?: string | null): EvidenceCodeHost | undefined {
  return parseCodeHostProvider(provider);
}

export function evidenceCodeHostDisplayName(provider?: string | null): string {
  const host = resolveEvidenceCodeHost(provider);
  return host ? CODE_HOST_NAMES[host] : "Code host";
}
