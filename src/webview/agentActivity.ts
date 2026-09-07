import type { NarrativeStep } from "./agentNarrative";
import { buildNarrativeTimeline, narrativeIconForLabel } from "./agentNarrative";
import { isIntegrationActivityLabel } from "../context/integrationActivityLabels";
import {
  ACTIVITY_START_DELAY_MS,
  activityPaceElapsedMs,
  buildConcreteActivityMessages,
  hasTerminalPreparingSignal,
  isSynthesisActivityPhase,
  resolvePacedActivityIndex,
  type ThinkingRotationOptions
} from "./thinkingMessageRotation";
import type { IntentFeedbackState, JobProgressState } from "./types";
import { activityFromAgentSteps, extractFileChipsFromLabels } from "../chat/chatTurnActivity";

export { extractFileChipsFromLabels };

/** Keep the checklist short so timed reveal stays feelable during long jobs. */
const MAX_ACTIVITY_TODOS = 5;

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export type AgentTodoItem = {
  id: string;
  content: string;
  status: AgentTodoStatus;
  /** Expandable hit list / error under a real search row. */
  detail?: string;
};

export type AgentToolRow = {
  id: string;
  kind: "search" | "read" | "explore" | "generic";
  label: string;
  status: "active" | "done";
};

export type AgentFileChip = {
  path: string;
  action: "read" | "searched" | "explored";
};

export type AgentActivityState = {
  todos: AgentTodoItem[];
  tools: AgentToolRow[];
  files: AgentFileChip[];
  /** True while the model is synthesizing — UI should keep Thinking/todos alive. */
  synthesisPhase?: boolean;
};

/**
 * Gather phase: reveal prep todos over time.
 * Synthesis phase: keep completed prep, then pace synthesis todos + living status
 * for the whole model wait (no frozen "Scan complete…" dead air).
 *
 * @param synthesisElapsedMs wall time since synthesis phase began (not total activity time)
 */
export function buildActivityTodosFromFeedback(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions,
  elapsedMs: number,
  waitingLabelStep = 0,
  synthesisElapsedMs = 0
): AgentTodoItem[] {
  const concrete = buildConcreteActivityMessages(intentFeedback, jobProgress);
  const prep =
    concrete.length > MAX_ACTIVITY_TODOS ? concrete.slice(concrete.length - MAX_ACTIVITY_TODOS) : concrete;

  // Beat after send — nothing yet so steps don't auto-dump on submit.
  if (elapsedMs < ACTIVITY_START_DELAY_MS && !hasTerminalPreparingSignal(intentFeedback, jobProgress)) {
    return [];
  }

  const synthesis = isSynthesisActivityPhase({
    intentFeedback,
    jobProgress,
    awaitingResponse: options.awaitingResponse,
    prepCount: prep.length,
    elapsedMs
  });

  if (synthesis) {
    return buildSynthesisActivityTodos(
      prep,
      intentFeedback,
      jobProgress,
      options,
      Math.max(0, synthesisElapsedMs),
      waitingLabelStep,
      elapsedMs
    );
  }

  if (!prep.length) {
    return [];
  }

  const activeIndex = resolvePacedActivityIndex({
    concreteCount: prep.length,
    elapsedMs
  });
  // Live tool lines (Slack/Jira/…) appear as soon as the backend posts them.
  const revealed = revealActivityMessages(prep, activeIndex);
  if (!revealed.length) {
    return [];
  }
  const timelineIndex = Math.max(0, revealed.length - 1);
  return buildNarrativeTimeline(revealed, timelineIndex).map((entry) => ({
    id: entry.id,
    content: entry.label,
    status: narrativeStatusToTodo(entry.status)
  }));
}

/** Timed reveal for generic steps; integration tool lines unlock immediately. */
function revealActivityMessages(prep: string[], activeIndex: number): string[] {
  const unlocked = new Set<string>();
  if (activeIndex >= 0) {
    for (const line of prep.slice(0, activeIndex + 1)) {
      unlocked.add(line);
    }
  }
  for (const line of prep) {
    if (isIntegrationActivityLabel(line)) {
      unlocked.add(line);
    }
  }
  return prep.filter((line) => unlocked.has(line));
}

function buildSynthesisActivityTodos(
  prep: string[],
  _intentFeedback: IntentFeedbackState | undefined,
  _jobProgress: JobProgressState | undefined,
  _options: ThinkingRotationOptions,
  synthesisElapsedMs: number,
  _waitingLabelStep: number,
  gatherElapsedMs: number
): AgentTodoItem[] {
  // Timed prep + every live tool line that already ran (Slack must stay visible).
  const revealedPrepIndex = resolvePacedActivityIndex({
    concreteCount: Math.max(prep.length, 1),
    elapsedMs: gatherElapsedMs
  });
  const revealedPrep = revealActivityMessages(prep, revealedPrepIndex);
  const completedPrep: AgentTodoItem[] = revealedPrep.map((label, index) => ({
    id: `prep:${index}:${label}`,
    content: label,
    status: "completed"
  }));

  // If prep was already on screen, hold it one beat before the first synthesis todo.
  // If there was no prep, don't add a second start delay — gather already waited.
  const synthPace =
    completedPrep.length > 0 ? activityPaceElapsedMs(synthesisElapsedMs) : Math.max(0, synthesisElapsedMs);
  if (completedPrep.length > 0 && synthPace <= 0) {
    const last = completedPrep[completedPrep.length - 1];
    return [...completedPrep.slice(0, -1), { ...last, status: "in_progress" }];
  }

  return completedPrep;
}

function narrativeStatusToTodo(status: NarrativeStep["status"]): AgentTodoStatus {
  if (status === "done") {
    return "completed";
  }
  if (status === "active") {
    return "in_progress";
  }
  return "pending";
}

export function toolRowsFromTodos(todos: AgentTodoItem[]): AgentToolRow[] {
  return todos
    .filter((todo) => todo.status !== "pending")
    .map((todo) => {
      const icon = narrativeIconForLabel(todo.content, todo.status === "in_progress");
      return {
        id: `tool:${todo.id}`,
        kind: icon === "search" ? "search" : icon === "read" ? "read" : icon === "loading" ? "explore" : "generic",
        label: todo.content,
        status: todo.status === "completed" ? "done" : "active"
      };
    });
}

export function mergeAgentActivity(
  base: AgentActivityState,
  overlay?: Partial<AgentActivityState>
): AgentActivityState {
  if (!overlay) {
    return base;
  }
  return {
    todos: overlay.todos?.length ? overlay.todos : base.todos,
    tools: overlay.tools?.length ? overlay.tools : base.tools,
    files: overlay.files?.length ? overlay.files : base.files,
    synthesisPhase: overlay.synthesisPhase ?? base.synthesisPhase
  };
}

export type AgentExplorationSummary = {
  explored?: string;
  exploring?: string;
};

/** Cursor-style tally: finished work vs current work — never “N more steps remaining.” */
export function summarizeAgentExploration(tools: AgentToolRow[]): AgentExplorationSummary | null {
  if (!tools.length) {
    return null;
  }
  const explored = phraseForTools(
    "Explored",
    tools.filter((tool) => tool.status === "done")
  );
  const exploring = phraseForTools(
    "Exploring",
    tools.filter((tool) => tool.status === "active")
  );
  if (!explored && !exploring) {
    return null;
  }
  return { explored, exploring };
}

function phraseForTools(verb: "Explored" | "Exploring", tools: AgentToolRow[]): string | undefined {
  if (!tools.length) {
    return undefined;
  }
  const searches = tools.filter((tool) => tool.kind === "search").length;
  const files = tools.filter((tool) => tool.kind === "read" || tool.kind === "explore").length;
  const parts: string[] = [];
  if (files > 0) {
    parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  }
  if (searches > 0) {
    parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  }
  if (!parts.length) {
    const n = tools.length;
    parts.push(`${n} ${n === 1 ? "action" : "actions"}`);
  }
  return `${verb} ${parts.join(", ")}`;
}

export function agentStepsToActivity(
  steps: Array<{ index: number; tool: string; summary: string; completed: boolean }>
): AgentActivityState {
  // Keep every real tool row. The panel folds them behind Explored / Exploring;
  // do not cap to the first three or invent a growing “N more steps” leftover.
  return activityFromAgentSteps(steps);
}
