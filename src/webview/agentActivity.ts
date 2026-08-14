import type { NarrativeStep } from "./agentNarrative";
import { buildNarrativeTimeline, narrativeIconForLabel } from "./agentNarrative";
import { isIntegrationActivityLabel } from "../context/integrationActivityLabels";
import {
  ACTIVITY_START_DELAY_MS,
  activityPaceElapsedMs,
  buildConcreteActivityMessages,
  buildWaitingActivityLabels,
  hasTerminalPreparingSignal,
  isSynthesisActivityPhase,
  resolvePacedActivityIndex,
  SYNTHESIS_TODO_MESSAGES,
  type ThinkingRotationOptions
} from "./thinkingMessageRotation";
import type { IntentFeedbackState, JobProgressState } from "./types";

/** Keep the checklist short so timed reveal stays feelable during long jobs. */
const MAX_ACTIVITY_TODOS = 5;
/** UX-G2: extra agent tool steps fold; Sources stay above the answer. */
const MAX_VISIBLE_AGENT_STEPS = 3;

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export type AgentTodoItem = {
  id: string;
  content: string;
  status: AgentTodoStatus;
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
    const waiting = buildWaitingActivityLabels(intentFeedback, jobProgress, options);
    if (!waiting.length) {
      return [];
    }
    const label = waiting[waitingLabelStep % waiting.length] ?? waiting[0];
    return [{ id: `wait:0:${label}`, content: label, status: "in_progress" }];
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
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions,
  synthesisElapsedMs: number,
  waitingLabelStep: number,
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

  const synthesisMessages = [...SYNTHESIS_TODO_MESSAGES];
  const activeIndex = resolvePacedActivityIndex({
    concreteCount: synthesisMessages.length,
    elapsedMs: synthPace,
    paced: true
  });
  const revealed = synthesisMessages.slice(0, activeIndex + 1);
  const synthesisTodos = buildNarrativeTimeline(revealed, activeIndex).map((entry) => ({
    id: `synth:${entry.id}`,
    content: entry.label,
    status: narrativeStatusToTodo(entry.status)
  }));

  // After the synthesis list is exhausted, keep the last row alive by rotating soft labels.
  const onFinalSynthesis = activeIndex >= synthesisMessages.length - 1;
  if (onFinalSynthesis && synthesisTodos.length) {
    const waiting = buildWaitingActivityLabels(intentFeedback, jobProgress, {
      ...options,
      rotationSeed: `${options.rotationSeed ?? "synthesis"}:live`
    });
    const whisper = waiting[waitingLabelStep % waiting.length];
    const last = synthesisTodos[synthesisTodos.length - 1];
    if (last && whisper) {
      synthesisTodos[synthesisTodos.length - 1] = {
        ...last,
        content: whisper,
        status: "in_progress"
      };
    }
  }

  // At most one newly active synthesis row plus previously shown prep — never a sudden pile.
  return [...completedPrep.slice(-2), ...synthesisTodos];
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

/** Pull `path`-like tokens from status lines for the files toolbar. */
export function extractFileChipsFromLabels(labels: string[]): AgentFileChip[] {
  const chips: AgentFileChip[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    const backtick = [...label.matchAll(/`([^`]+)`/g)];
    for (const match of backtick) {
      const path = (match[1] ?? "").trim();
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      const lower = label.toLowerCase();
      const action: AgentFileChip["action"] = lower.includes("read")
        ? "read"
        : lower.includes("search")
          ? "searched"
          : "explored";
      chips.push({ path, action });
    }
    const pathLike = label.match(/\b([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md|json|yml|yaml))\b/);
    if (pathLike?.[1] && !seen.has(pathLike[1])) {
      seen.add(pathLike[1]);
      chips.push({ path: pathLike[1], action: "explored" });
    }
  }
  return chips.slice(0, 40);
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

export function agentStepsToActivity(
  steps: Array<{ index: number; tool: string; summary: string; completed: boolean }>
): AgentActivityState {
  const extra = Math.max(0, steps.length - MAX_VISIBLE_AGENT_STEPS);
  const visible = extra > 0 ? steps.slice(0, MAX_VISIBLE_AGENT_STEPS) : steps;
  const todos: AgentTodoItem[] = visible.map((step) => ({
    id: `agent-${step.index}-${step.tool}`,
    content: humanizeAgentSummary(step.tool, step.summary),
    status: step.completed ? "completed" : "in_progress"
  }));
  if (extra > 0) {
    todos.push({
      id: "agent-more",
      content: `${extra} more step${extra === 1 ? "" : "s"}`,
      status: "pending"
    });
  }
  const tools: AgentToolRow[] = visible.map((step) => ({
    id: `agent-tool-${step.index}`,
    kind: toolKindFromName(step.tool),
    label: humanizeAgentSummary(step.tool, step.summary),
    status: step.completed ? "done" : "active"
  }));
  const files = extractFileChipsFromLabels(steps.map((step) => step.summary));
  return { todos, tools, files };
}

function toolKindFromName(tool: string): AgentToolRow["kind"] {
  if (tool.includes("search")) {
    return "search";
  }
  if (tool.includes("read")) {
    return "read";
  }
  if (tool.includes("list") || tool.includes("directory")) {
    return "explore";
  }
  return "generic";
}

function humanizeAgentSummary(tool: string, summary: string): string {
  const trimmed = summary.trim();
  if (tool === "search_code") {
    const q = trimmed.replace(/^search_code:\s*/i, "");
    return q ? `Searched for \`${q}\`` : "Searched the codebase";
  }
  if (tool === "read_file") {
    const path = trimmed.replace(/^read_file:\s*/i, "");
    return path ? `Read \`${path}\`` : "Read a file";
  }
  if (tool === "list_directory") {
    const path = trimmed.replace(/^list_directory:\s*/i, "") || "/";
    return `Explored \`${path}\``;
  }
  if (tool === "git_blame") {
    return trimmed.replace(/^git_blame:\s*/i, "Traced blame for ");
  }
  return trimmed || tool;
}
