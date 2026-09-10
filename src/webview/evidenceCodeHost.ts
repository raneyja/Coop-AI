import type { EvidenceCodeHost } from "../api/codeHosts/codeHostLabels";
import {
  evidenceCodeHostDisplayName,
  resolveEvidenceCodeHost
} from "../api/codeHosts/codeHostLabels";

export type { EvidenceCodeHost };
export { evidenceCodeHostDisplayName, resolveEvidenceCodeHost };

/** Brand id for Source Details connection groups / chips. Undefined when the host is unknown. */
export function evidenceCodeHostConnection(provider?: string | null): EvidenceCodeHost | undefined {
  return resolveEvidenceCodeHost(provider);
}
