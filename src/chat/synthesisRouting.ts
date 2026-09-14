import type { UseCase } from "../api/types";
import { isIncidentShapedQuery, isTicketPickupLocateQuery } from "../context/incidentIntent";
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
 */
export function resolvePlainChatSynthesisRoute(input: {
  userQuestion: string;
  integrationProvider?: IntegrationChatProvider;
  fetchIntegrations?: IntegrationChatProvider[];
  intentPlan?: ChatIntentPlan;
}): PlainChatSynthesisRoute {
  // Ticket pickup (Jira key + named symbol) is locate+decision, never incident.
  if (isIncidentShapedQuery(input.userQuestion) && !isTicketPickupLocateQuery(input.userQuestion)) {
    return { kind: "incident", useCase: "chat" };
  }

  const jobs = input.intentPlan?.jobs ?? [];
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
