import type { StreamChatParams } from "./SecureApiClient";
import type { ReviewedSourceWindow } from "../prompts/sourceCitationIntegrity";
import { snapshotSourceClaimEvidence, sourceClaimModelWindows, type SourceClaimFact, type SourceClaimRelations } from "./sourceClaimReview";
import {resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS} from "../config/featureModelAssignments";

/** Derived summaries, old model prose and legacy bundles are not proof. */
export function buildSourceEvidenceSynthesisRequest(request: StreamChatParams, question: string | undefined,
  windows: ReviewedSourceWindow[], facts: SourceClaimFact[] = [], relations?: SourceClaimRelations): StreamChatParams {
  const evidence = snapshotSourceClaimEvidence(request, windows, relations, facts);
  return {...request, sourceClaimReview: false, sourceEvidenceSynthesis: true, sourceEvidenceRepair: false,
    // Reasoning shares the output allowance. Observed 8k source audits could
    // consume it entirely before emitting any answer; retain reasoning with
    // enough completion capacity instead of weakening the quality policy.
    maxTokens: request.enableThinking ? Math.max(request.maxTokens ?? 0, 16_000) : request.maxTokens,
    history: [], attachments: undefined, mentions: undefined, ordinaryTurn: undefined,
    context: {owner: request.context.owner, repo: request.context.repo, branch: request.context.branch, file: request.context.file},
    message: JSON.stringify({schema: "coop-source-evidence-v1", task: question?.trim() || `Review the admitted evidence for the ${request.useCase} quick action.`, action: request.useCase,
      ...evidence, windows: sourceClaimModelWindows(evidence.windows)})};
}

/** One corrective draft uses the quality assignment, retaining the original
 * frozen task/evidence and user turn. It still passes the publication gate. */
export function buildSourceEvidenceRepairRequest(synthesis: StreamChatParams, message: string): StreamChatParams {
  return {...synthesis, ...resolveAssignedSourceVerificationModel(), sourceClaimReview: false,
    sourceEvidenceSynthesis: true, sourceEvidenceRepair: true, maxTokens: SOURCE_VERIFICATION_MAX_TOKENS,
    enableThinking: true, history: [], message};
}
