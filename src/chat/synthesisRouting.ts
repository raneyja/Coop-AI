import type { UseCase } from "../api/types";
import { isIncidentShapedQuery, isTicketPickupLocateQuery } from "../context/incidentIntent";
import { jobsKeptOnFileAssistantTurn, type SessionMode } from "../context/sessionMode";
import type { IntegrationChatProvider } from "./types";
import type { ChatIntentPlan } from "./intentPlanner";

export type PlainChatSynthesisRoute =
  | { kind: "incident"; useCase: "chat" }
  | { kind: "intent-job"; useCase: "intent_job"; tools: IntegrationChatProvider[] }
  | { kind: "integration"; useCase: "integration"; provider: IntegrationChatProvider }
  | { kind: "plain"; useCase: "chat" };

/**
 * One owner for plain-chat synthesis precedence.
 *
 * Incident semantics win over a planner tool allowlist. Compound intent jobs
 * stay together under one writer. A single explicitly routed integration keeps
 * its provider-specific contract; everything else remains plain chat.
 *
 * File-assistant is an explicit session mode. A leftover locate or code-host
 * job must not select intent-job. Do not infer that mode from the question.
 */
export function resolvePlainChatSynthesisRoute(input: {
  userQuestion: string;
  integrationProvider?: IntegrationChatProvider;
  fetchIntegrations?: IntegrationChatProvider[];
  intentPlan?: ChatIntentPlan;
  sessionMode?: SessionMode;
}): PlainChatSynthesisRoute {
  const fileAssistant = input.sessionMode === "file-assistant";
  // Ticket pickup (Jira key + named symbol) is locate+decision, never incident.
  // L turns stay with the open file — do not infer incident from the question.
  if (
    !fileAssistant &&
    isIncidentShapedQuery(input.userQuestion) &&
    !isTicketPickupLocateQuery(input.userQuestion)
  ) {
    return { kind: "incident", useCase: "chat" };
  }

  const planned = input.intentPlan?.jobs ?? [];
  const jobs = fileAssistant ? jobsKeptOnFileAssistantTurn(planned) : planned;
  if (jobs.length > 0) {
    return {
      kind: "intent-job",
      useCase: "intent_job",
      tools: input.fetchIntegrations ?? input.intentPlan?.tools ?? []
    };
  }

  if (input.integrationProvider) {
    return {
      kind: "integration",
      useCase: "integration",
      provider: input.integrationProvider
    };
  }

  return { kind: "plain", useCase: "chat" };
}

export function useCaseForSynthesisRoute(
  route: PlainChatSynthesisRoute,
  fallback: UseCase
): UseCase {
  return route.kind === "plain" ? fallback : route.useCase;
}
