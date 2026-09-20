/**
 * Chat front door — interpret once, then hand off to an existing tool.
 *
 * A slash command / Workflows action is a constraint (Slack only, blast only).
 * It does not skip interpretation. The interpreter names jobs and search terms;
 * fetchers already in the tree do the work.
 */
import { jobSearchActivityQuery, planJobSearchAttempts } from "../../context/jobSearchPlan";
import { parseSlashCommand, type ParsedSlashCommand } from "../../context/slashCommands";
import { omitTeamsWhileComingSoon } from "../../integrations/teamsAvailability";
import { isQuickActionId } from "../../webview/types";
import type { ComposerMode, IntegrationChatProvider } from "../types";
import type { IntentSuggestCompleteFn } from "../quickActionIntentModel";
import { classifyChatIntentPlan, shouldCallChatIntentModel } from "./planChatIntentModel";
import { planChatIntentFromRules } from "./planChatIntent";
import { demoteUnconstrainedWorkflow } from "./resolveExecution";
import {
  classifyChatAskAssignment,
  extraTermsForIntegration,
  jobVerbForIntegration,
  planChatJobs,
  planChatTasks,
  planChatTodos,
  stripLeadingAskLabels,
  uniqueTerms
} from "./planChatJobs";
import { isRepoSlugTerm } from "./repoSlugTerm";
import { isSearchMeaningStop } from "./searchMeaningStop";
import {
  emptyChatIntentPlan,
  isChatIntentWorkflow,
  type ChatCommandConstraint,
  type ChatIntentJob,
  type ChatIntentJobCapability,
  type ChatIntentPlan,
  type ChatIntentPlannerInput,
  type ChatIntentWorkflow
} from "./types";

const HYPHEN_TOPIC = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;
const DOCS_PROVIDERS: readonly IntegrationChatProvider[] = [
  "confluence",
  "notion",
  "google-docs"
];

/** Cheap interpreter classify — always Auto via /v1/chat. Never send as `chat`. */
export const FRONT_DOOR_INTERPRETER_USE_CASE = "intent_suggest" as const;

export const SLACK_SQL_INJECTION_SLASH_ASK =
  "/slack What did #epd say about not mixing date math into the SQL-injection PR?";

export type FrontDoorSendFlags = {
  skipChatIntentPlanner?: boolean;
  intentPlan?: ChatIntentPlan;
  integrationProvider?: IntegrationChatProvider;
  sourceHint?: string;
  composerMode?: ComposerMode;
  quickAction?: string;
};

export type FrontDoorModelOptions = {
  complete: IntentSuggestCompleteFn;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Re-entry carries a plan. First entry always interprets — including slash. */
export function shouldInterpretChatAsk(flags?: FrontDoorSendFlags): boolean {
  return !flags?.skipChatIntentPlanner;
}

export function constraintFromSlash(parsed: ParsedSlashCommand): ChatCommandConstraint {
  const target = parsed.def.target;
  if (target.kind === "integration") {
    return { kind: "integration", provider: target.provider };
  }
  if (target.kind === "action") {
    return { kind: "workflow", workflow: target.actionId };
  }
  if (target.kind === "composer-mode") {
    return { kind: "edit" };
  }
  if (target.kind === "compare") {
    return { kind: "compare" };
  }
  return { kind: "none" };
}

export function resolveChatCommandConstraint(options: {
  parsed?: ParsedSlashCommand | null;
  quickAction?: string;
  composerMode?: ComposerMode;
  integrationProvider?: IntegrationChatProvider;
}): ChatCommandConstraint {
  if (options.parsed) {
    return constraintFromSlash(options.parsed);
  }
  if (options.integrationProvider) {
    return { kind: "integration", provider: options.integrationProvider };
  }
  if (options.composerMode === "edit") {
    return { kind: "edit" };
  }
  if (options.quickAction && isQuickActionId(options.quickAction) && isChatIntentWorkflow(options.quickAction)) {
    return { kind: "workflow", workflow: options.quickAction };
  }
  return { kind: "none" };
}

/** Topic text the interpreter reads — slash token stripped, not the whole command line. */
export function frontDoorInterpretText(options: {
  rawAsk: string;
  parsed?: ParsedSlashCommand | null;
  slashUserArgs?: string;
}): string {
  if (options.parsed) {
    return options.parsed.focus.trim();
  }
  const args = options.slashUserArgs?.trim();
  if (args) {
    return args;
  }
  return options.rawAsk.trim();
}

export function hasAskTopic(message: string | undefined, useRepo?: string): boolean {
  return classifyChatAskAssignment(message ?? "", useRepo).kind !== "none";
}

/**
 * Exact queries each tool will send (phrase, then distinctive words).
 * Activity chips must use the same first string.
 */
export function plannedToolSearchQueries(
  plan: ChatIntentPlan
): Partial<Record<IntegrationChatProvider, string[]>> {
  const out: Partial<Record<IntegrationChatProvider, string[]>> = {};
  for (const tool of plan.tools) {
    if (jobVerbForIntegration(plan.jobs, tool) === "latest") {
      out[tool] = ["latest"];
      continue;
    }
    const terms = extraTermsForIntegration(plan.jobs, tool) ?? [];
    const attempts = planJobSearchAttempts(terms).map((attempt) => attempt.text);
    if (attempts.length > 0) {
      out[tool] = attempts;
    }
  }
  return out;
}

export function jobScopedActivityQuery(terms: string[]): string | undefined {
  return jobSearchActivityQuery(terms);
}

export function planChatFrontDoorFromRules(input: ChatIntentPlannerInput): ChatIntentPlan {
  const message = input.message?.trim() ?? "";
  if (input.disabled) {
    return emptyChatIntentPlan(message);
  }
  const rules =
    message.length < 8 ? emptyChatIntentPlan(message) : planChatIntentFromRules(input);
  return applyChatCommandConstraint(rules, input);
}

export async function planChatFrontDoor(
  input: ChatIntentPlannerInput,
  model?: FrontDoorModelOptions
): Promise<ChatIntentPlan> {
  const rulesPlan = planChatFrontDoorFromRules(input);
  if (!model?.complete || !shouldCallChatIntentModel(rulesPlan, input)) {
    return rulesPlan;
  }
  try {
    const refined = await classifyChatIntentPlan(input, model.complete, {
      signal: model.signal,
      timeoutMs: model.timeoutMs
    });
    if (!refined) {
      return rulesPlan;
    }
    const merged = mergeFrontDoorPlans(rulesPlan, refined, input);
    return applyChatCommandConstraint(merged, input);
  } catch {
    return rulesPlan;
  }
}

/** Live send-path helper: parse a raw composer line the same way handleChatSend does. */
export function planRawChatAskFromRules(
  rawAsk: string,
  options?: {
    connectedTools?: IntegrationChatProvider[];
    activeFile?: string;
    useRepo?: string;
    quickAction?: string;
    composerMode?: ComposerMode;
    integrationProvider?: IntegrationChatProvider;
  }
): {
  constraint: ChatCommandConstraint;
  interpretMessage: string;
  plan: ChatIntentPlan;
  toolQueries: Partial<Record<IntegrationChatProvider, string[]>>;
} {
  const parsed = parseSlashCommand(rawAsk);
  const constraint = resolveChatCommandConstraint({
    parsed,
    quickAction: options?.quickAction,
    composerMode: options?.composerMode,
    integrationProvider: options?.integrationProvider
  });
  const interpretMessage = frontDoorInterpretText({ rawAsk, parsed });
  const plan = planChatFrontDoorFromRules({
    message: interpretMessage,
    activeFile: options?.activeFile,
    connectedTools: options?.connectedTools ?? ["slack", "jira", "confluence"],
    constraint,
    useRepo: options?.useRepo
  });
  return {
    constraint,
    interpretMessage,
    plan,
    toolQueries: plannedToolSearchQueries(plan)
  };
}

export function applyChatCommandConstraint(
  plan: ChatIntentPlan,
  input: ChatIntentPlannerInput
): ChatIntentPlan {
  const constraint = input.constraint ?? { kind: "none" };
  if (constraint.kind === "none") {
    return demoteUnconstrainedWorkflow(dropRepoTermsWhenTopicExists(plan, input));
  }
  if (constraint.kind === "integration") {
    return constrainToIntegration(plan, constraint.provider, input);
  }
  if (constraint.kind === "workflow") {
    return constrainToWorkflow(plan, constraint.workflow, input);
  }
  return dropRepoTermsWhenTopicExists(
    {
      ...plan,
      focus: plan.focus || stripLeadingAskLabels(input.message) || input.message
    },
    input
  );
}

export function mergeInterpreterJobs(
  rulesJobs: ChatIntentJob[] | undefined,
  modelJobs: ChatIntentJob[] | undefined,
  input: Pick<ChatIntentPlannerInput, "message" | "useRepo">
): ChatIntentJob[] {
  const merged = new Map<ChatIntentJobCapability, ChatIntentJob>();
  for (const job of rulesJobs ?? []) {
    merged.set(job.capability, { ...job, terms: [...job.terms] });
  }
  for (const job of modelJobs ?? []) {
    const terms = uniqueTerms(
      job.terms.filter((term) => isValidInterpreterTerm(term, input))
    );
    if (terms.length === 0 && job.verb !== "latest") {
      continue;
    }
    const verb = terms.length > 0 ? "search" : job.verb === "latest" ? "latest" : "search";
    merged.set(job.capability, { capability: job.capability, verb, terms });
  }
  return [...merged.values()];
}

function mergeFrontDoorPlans(
  rulesPlan: ChatIntentPlan,
  modelPlan: ChatIntentPlan,
  input: ChatIntentPlannerInput
): ChatIntentPlan {
  const jobs = mergeInterpreterJobs(rulesPlan.jobs, modelPlan.jobs, input);
  const tools =
    rulesPlan.tools.length > 0 ? rulesPlan.tools : modelPlan.tools;
  const demotedModel = demoteUnconstrainedWorkflow(modelPlan);
  const tasks = planChatTasks({ jobs, tools });
  // English/model must never copy a workflow onto an unconstrained turn.
  // `applyChatCommandConstraint` pins workflow only for explicit slash/QA.
  return demoteUnconstrainedWorkflow({
    ...rulesPlan,
    workflow: undefined,
    tools,
    jobs,
    tasks,
    todos: planChatTodos(tasks),
    mode:
      rulesPlan.mode === "none" && demotedModel.mode !== "none"
        ? demotedModel.mode
        : rulesPlan.mode,
    execution: "none",
    confidence:
      rulesPlan.confidence === "low" && demotedModel.confidence !== "low"
        ? demotedModel.confidence
        : rulesPlan.confidence,
    reason: demotedModel.reason
      ? `${rulesPlan.reason ?? "rules"}+${demotedModel.reason}`
      : rulesPlan.reason
  });
}

function constrainToIntegration(
  plan: ChatIntentPlan,
  provider: IntegrationChatProvider,
  input: ChatIntentPlannerInput
): ChatIntentPlan {
  const tools = omitTeamsWhileComingSoon(
    provider === "teams" ? (["teams"] as IntegrationChatProvider[]) : [provider]
  );
  const assignment = classifyChatAskAssignment(input.message, input.useRepo);
  const capability = docsCapabilityFor(provider, input.message);
  let jobs = (plan.jobs ?? []).filter((job) => job.capability === capability);
  if (assignment.kind === "none") {
    jobs = [];
  } else if (assignment.kind === "latest") {
    jobs = [{ capability, verb: "latest", terms: [] }];
  } else {
    jobs = jobs.map((job) => ({
      ...job,
      verb: "search" as const,
      terms: job.terms.filter((term) => !isRepoSlugTerm(term, input.useRepo))
    }));
    if (jobs.length === 0 || jobs.every((job) => job.terms.length === 0)) {
      const terms = fallbackTopicTerms(input.message, input.useRepo);
      if (terms.length > 0) {
        jobs = [{ capability, verb: "search", terms }];
      } else {
        jobs = jobs.filter((job) => job.terms.length > 0);
      }
    }
  }
  const tasks = planChatTasks({ jobs, tools });
  return {
    ...plan,
    mode: "tools-only",
    workflow: undefined,
    execution: "none",
    tools,
    jobs,
    tasks,
    todos: planChatTodos(tasks),
    codeIntent: { action: "none", confidence: "low", reason: "integration-command" },
    focus: stripLeadingAskLabels(input.message) || input.message,
    reason: `command:${provider}`
  };
}

function constrainToWorkflow(
  plan: ChatIntentPlan,
  workflow: ChatIntentWorkflow,
  input: ChatIntentPlannerInput
): ChatIntentPlan {
  const cleaned = dropRepoTermsWhenTopicExists(plan, input);
  return {
    ...cleaned,
    workflow,
    mode: "run-workflow",
    execution: "silent",
    confidence: cleaned.confidence === "low" ? "high" : cleaned.confidence,
    tools: omitTeamsWhileComingSoon(cleaned.tools),
    focus: stripLeadingAskLabels(input.message) || cleaned.focus || input.message,
    reason: `command:${workflow}`
  };
}

function dropRepoTermsWhenTopicExists(
  plan: ChatIntentPlan,
  input: ChatIntentPlannerInput
): ChatIntentPlan {
  if (!hasAskTopic(input.message, input.useRepo) || !plan.jobs?.length) {
    return plan;
  }
  const jobs = plan.jobs.map((job) => ({
    ...job,
    terms: job.terms.filter((term) => !isRepoSlugTerm(term, input.useRepo))
  }));
  const tools = omitTeamsWhileComingSoon(plan.tools);
  const tasks = planChatTasks({ jobs, tools });
  return { ...plan, jobs, tools, tasks, todos: planChatTodos(tasks) };
}

function docsCapabilityFor(
  provider: IntegrationChatProvider,
  message: string
): ChatIntentJobCapability {
  if (provider === "google-docs") {
    return "docs";
  }
  if (
    (provider === "confluence" || provider === "notion") &&
    !/\b(?:decid(?:e|ed|ing)|what\s+did|say about|mix)\b/i.test(message)
  ) {
    return "docs";
  }
  return "decision";
}

function fallbackTopicTerms(message: string, useRepo?: string): string[] {
  const fromJobs = planChatJobs({ message }).flatMap((job) =>
    job.capability === "locate" ? [] : job.terms
  );
  const hyphen: string[] = [];
  HYPHEN_TOPIC.lastIndex = 0;
  for (const match of message.matchAll(HYPHEN_TOPIC)) {
    hyphen.push(match[0]);
  }
  const distinctive = stripLeadingAskLabels(message)
    .replace(/[#/]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9-]+/g, ""))
    .filter(
      (token) =>
        token.length >= 5 &&
        !isSearchMeaningStop(token) &&
        !isRepoSlugTerm(token, useRepo)
    );
  return uniqueTerms(
    [...fromJobs, ...hyphen, ...distinctive].filter((term) => !isRepoSlugTerm(term, useRepo))
  ).slice(0, 4);
}

export function isValidInterpreterTerm(
  term: string,
  input: Pick<ChatIntentPlannerInput, "message" | "useRepo">
): boolean {
  const trimmed = term.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || trimmed.length > 48) {
    return false;
  }
  const words = trimmed.split(/\s+/);
  if (words.length > 6) {
    return false;
  }
  const message = stripLeadingAskLabels(input.message ?? "").trim();
  if (message && trimmed.toLowerCase() === message.toLowerCase()) {
    return false;
  }
  return !isRepoSlugTerm(trimmed, input.useRepo);
}

export { isRepoSlugTerm };
