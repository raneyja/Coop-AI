import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import { SOURCE_CLAIM_REVIEW_SCHEMA } from "../prompts/sourceClaimReview";

/** Test-only scripted adjudication for publication/transport controls. These
 * synthetic statuses do not certify model judgment and must never backfill a
 * live review or saved production ledger. */
export function sourceClaimVerdictFixture(request: StreamChatParams,
  issues: Array<{claim: string; category: string; reason: string}> = []): string {
  const input = JSON.parse(request.message);
  const window = input.windows[0];
  const supports = window ? [{windowId: window.id, startLine: window.startLine,
    endLine: window.endLine}]
    : input.facts[0] ? [{factId: input.facts[0].id}] : [];
  const checks = input.blocks.map((block: {id: string; text: string}) => {
      const issue = issues.find(item => (block.text.includes(item.claim) || item.claim.includes(block.text)));
      return {blockId: block.id, kind: supports.length ? "fact" : "scope",
        decision: issue ? "revise" : "supported", supports,
        qualificationStatus: issue ? "missing" : "none-required",
        counterexampleStatus: issue ? "unresolved-contradiction" : "consistent",
        publicQualifications: [],
        conditions: "Fixture-author adjudication", counterexample: "Fixture-author adjudication only", boundary: "Synthetic test only",
        category: issue?.category ?? "scope", reason: issue?.reason ?? "Adjudicated by test fixture"};
    });
  return JSON.stringify({schema: SOURCE_CLAIM_REVIEW_SCHEMA, candidateId: input.candidateId,
    evidenceId: input.evidenceId, verdict: checks.some((check: {decision: string}) => check.decision === "revise") ? "revise" : "supported",
    checks});
}

/** Existing quote/structure tests keep their generator assertions; semantic
 * gate behavior and actual call/usage bounds have independent tests. */
export function withPassingClaimReview(stream: SecureApiClient["streamChat"]): SecureApiClient["streamChat"] {
  return async (request, ...args) => {
    if (!request.sourceClaimReview) return stream(request, ...args);
    return { message: { role: "assistant", timestamp: 1,
      content: sourceClaimVerdictFixture(request) },
      finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
        model: request.model, provider: request.provider } };
  };
}
