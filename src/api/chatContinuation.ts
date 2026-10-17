import type { V1ChatRequestBody } from "./types";
import { hasTrailingEmptyHeadings, LENGTH_CONTINUE_PROMPT } from "../chat/lengthContinue";

/** One transport representation, shared by the client and server binding.
 * Ignore UI metadata, while preserving all model-affecting string bytes and
 * array order. JSON cloning captures media/context before any asynchronous work. */
export function normalizeChatRequestBody(body: V1ChatRequestBody): V1ChatRequestBody {
  const context = body.context ?? {};
  return JSON.parse(JSON.stringify({
    message: body.message,
    history: (body.history ?? []).map(entry => ({role: entry.role, content: entry.content, attachments: entry.attachments})),
    context: {owner: context.owner, repo: context.repo, branch: context.branch, file: context.file,
      selectedLines: context.selectedLines, languageId: context.languageId,
      contextBundle: context.contextBundle, projectInstructions: context.projectInstructions},
    attachments: body.attachments,
    mentions: body.mentions?.map(mention => ({repoId: mention.repoId, path: mention.path, lines: mention.lines})),
    model: body.model, provider: body.provider, useCase: body.useCase,
    temperature: body.temperature, maxTokens: body.maxTokens,
    enableThinking: body.enableThinking === true,
    sourceClaimReview: body.sourceClaimReview === true,
    sourceEvidenceSynthesis: body.sourceEvidenceSynthesis === true,
    sourceEvidenceRepair: body.sourceEvidenceRepair === true,
    sessionMode: body.sessionMode, fileSource: body.fileSource,
    ordinaryTurn: body.ordinaryTurn && {phase: body.ordinaryTurn.phase, task: body.ordinaryTurn.task,
      answerUseCase: body.ordinaryTurn.answerUseCase},
    quotaTurnId: body.quotaTurnId
  })) as V1ChatRequestBody;
}

/** Construct the only permitted ordinary recovery: exact admitted user input,
 * original history/media/context/options, and the server-observed answer. */
export function buildChatContinuation(initial: V1ChatRequestBody, answer: string): V1ChatRequestBody {
  const request = normalizeChatRequestBody(initial);
  if (request.ordinaryTurn?.phase !== "answer") throw new Error("Continuation requires an admitted ordinary answer.");
  return normalizeChatRequestBody({...request, message: LENGTH_CONTINUE_PROMPT,
    history: [...(request.history ?? []),
      {role: "user", content: request.message, attachments: request.attachments},
      {role: "assistant", content: answer}],
    attachments: undefined, enableThinking: false,
    ordinaryTurn: {...request.ordinaryTurn, phase: "continue"}});
}

export function isNativeContinuationEligible(finishReason: string, answer: string): boolean {
  return finishReason === "length" || finishReason === "stop" && hasTrailingEmptyHeadings(answer);
}
