/**
 * Front-door model completions that hit `/v1/chat` (and therefore the usage bar).
 * Slack/Jira/repo search are not listed — they are not model calls.
 */
import type { UseCase } from "../../api/types";
import { resolveChatUseCase } from "../../prompts/systemPrompts";
import { isIntentSuggestModelEnabled } from "../../config/intentSuggestConfig";
import { resolvePlainChatSynthesisRoute, useCaseForSynthesisRoute } from "../synthesisRouting";
import { shouldCallChatIntentModel } from "./planChatIntentModel";
import {
  FRONT_DOOR_INTERPRETER_USE_CASE,
  planChatFrontDoorFromRules,
  planRawChatAskFromRules,
  shouldInterpretChatAsk,
  type FrontDoorSendFlags
} from "./frontDoor";
import type { IntegrationChatProvider } from "../types";

export type FrontDoorCompletionRole = "interpreter" | "answer";

export type FrontDoorChatCompletion = {
  role: FrontDoorCompletionRole;
  useCase: UseCase;
};

export type PlanFrontDoorCompletionsInput = FrontDoorSendFlags & {
  rawAsk: string;
  /** When false, fail-open to regex — no interpreter tokens. */
  modelEnabled?: boolean;
  connectedTools?: IntegrationChatProvider[];
  useRepo?: string;
  activeFile?: string;
};

/**
 * Model calls one send will make. Interpret phase never includes the answer
 * (slash returns into a second handleChatSend). Answer phase never interprets.
 */
export function planFrontDoorChatCompletions(
  input: PlanFrontDoorCompletionsInput
): FrontDoorChatCompletion[] {
  const turn = planRawChatAskFromRules(input.rawAsk, {
    connectedTools: input.connectedTools,
    useRepo: input.useRepo,
    activeFile: input.activeFile,
    quickAction: input.quickAction,
    composerMode: input.composerMode,
    integrationProvider: input.integrationProvider
  });
  const completions: FrontDoorChatCompletion[] = [];
  const modelEnabled = input.modelEnabled ?? isIntentSuggestModelEnabled();
  if (
    shouldInterpretChatAsk(input) &&
    modelEnabled &&
    shouldCallChatIntentModel(turn.plan, {
      constraint: turn.constraint,
      message: turn.interpretMessage
    })
  ) {
    completions.push({
      role: "interpreter",
      useCase: FRONT_DOOR_INTERPRETER_USE_CASE
    });
  }

  const integrationProvider =
    turn.constraint.kind === "integration" ? turn.constraint.provider : input.integrationProvider;
  const workflow =
    turn.constraint.kind === "workflow" ? turn.constraint.workflow : undefined;
  const route = resolvePlainChatSynthesisRoute({
    userQuestion: turn.interpretMessage || input.rawAsk,
    integrationProvider,
    fetchIntegrations: turn.plan.tools,
    intentPlan: turn.plan
  });
  let answerUseCase = resolveChatUseCase(
    workflow ?? input.quickAction,
    integrationProvider,
    input.composerMode
  );
  answerUseCase = useCaseForSynthesisRoute(route, answerUseCase);
  completions.push({ role: "answer", useCase: answerUseCase });
  return completions;
}

/** First handleChatSend: interpret (and maybe return before answering). */
export function planFrontDoorInterpretCompletions(
  input: PlanFrontDoorCompletionsInput
): FrontDoorChatCompletion[] {
  return planFrontDoorChatCompletions(input).filter((row) => row.role === "interpreter");
}

/** Slash/Workflows re-entry: answer only. */
export function planFrontDoorAnswerCompletions(
  input: PlanFrontDoorCompletionsInput
): FrontDoorChatCompletion[] {
  return planFrontDoorChatCompletions({
    ...input,
    skipChatIntentPlanner: true
  }).filter((row) => row.role === "answer");
}
