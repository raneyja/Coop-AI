import type { EvidenceCodeHost } from "../api/codeHosts/codeHostLabels";
import {
  evidenceCodeHostDisplayName,
  resolveEvidenceCodeHost
} from "../api/codeHosts/codeHostLabels";
import type { IntegrationSourceId } from "./components/IntegrationSourceBrand";

export type { EvidenceCodeHost };
export { evidenceCodeHostDisplayName, resolveEvidenceCodeHost };

/** Brand id for Source Details connection groups / chips. */
export function evidenceCodeHostConnection(
  provider?: string | null
): Extract<IntegrationSourceId, EvidenceCodeHost> {
  return resolveEvidenceCodeHost(provider);
}
