import { isIntegrationActivityLabel } from "../context/integrationActivityLabels";
import { isThinkingProcessingTermMessage } from "../context/thinkingProcessingTerms";
import { extractNamedSourceFiles } from "../api/agent/searchQuery";
import { hasRepoFactNeed, repoFactNeeds } from "../workspace/repoFactIntent";
import type {
  ChatMessage,
  ChatTurnActivity,
  ChatTurnActivityFile,
  ChatTurnActivityTodo,
  ChatTurnActivityTool
} from "./types";

export const CHAT_TURN_ACTIVITY_THINKING_CAP = 32_000;

const SYNTHESIS_FILLER = new Set([
  "Weighing gathered evidence…",
  "Connecting docs and code signals…",
  "Drafting findings…",
  "Checking ownership and open questions…",
  "Prioritizing what matters…",
  "Writing your answer…"
]);

export type ChatTurnAgentStep = {
  index: number;
  tool: string;
  summary: string;
  completed: boolean;
};

export type ChatTurnActivityAccumulator = {
  startedAt: number;
  thinkingText?: string;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  agentSteps?: ChatTurnAgentStep[];
  activityLines?: string[];
  /** User ask for this turn — named files still get a Read chip on gather-only answers. */
  modelMessage?: string;
};

export function isTerminalPreparingMessage(message: string): boolean {
  const trimmed = message.trim();
  return (
    /preparing (your )?answer/i.test(trimmed) ||
    /^scan complete\b/i.test(trimmed) ||
    /^graph ready\b/i.test(trimmed)
  );
}

export function isConcreteActivityLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (isThinkingProcessingTermMessage(trimmed) || isTerminalPreparingMessage(trimmed)) {
    return false;
  }
  if (SYNTHESIS_FILLER.has(trimmed)) {
    return false;
  }
  if (isIntegrationActivityLabel(trimmed)) {
    return true;
  }
  if (/^(Searched|Read|Explored|Traced|Pulling|Reviewing|Looked up)\b/i.test(trimmed)) {
    return true;
  }
  return /`[^`]+`/.test(trimmed);
}

export const INDEXED_INVENTORY_ACTIVITY = "Looked up indexed inventory";
export const REPO_LAYOUT_ACTIVITY = "Explored repository layout";

/** Honest trail line for file-count / LOC / layout asks that never run the hunt loop. */
export function repoFactActivityLabel(query: string | undefined): string | undefined {
  if (!query?.trim()) {
    return undefined;
  }
  const needs = repoFactNeeds(query);
  if (!hasRepoFactNeed(needs)) {
    return undefined;
  }
  if (needs.treeOverview && !needs.fileCount && !needs.lineCount) {
    return REPO_LAYOUT_ACTIVITY;
  }
  return INDEXED_INVENTORY_ACTIVITY;
}

export function appendTurnThinkingChunk(
  turn: ChatTurnActivityAccumulator,
  chunk: string,
  now = Date.now()
): void {
  if (!chunk) {
    return;
  }
  if (turn.thinkingStartedAt === undefined) {
    turn.thinkingStartedAt = now;
  }
  turn.thinkingEndedAt = now;
  const next = `${turn.thinkingText ?? ""}${chunk}`;
  turn.thinkingText =
    next.length > CHAT_TURN_ACTIVITY_THINKING_CAP
      ? next.slice(-CHAT_TURN_ACTIVITY_THINKING_CAP)
      : next;
}

export function recordTurnAgentSteps(
  turn: ChatTurnActivityAccumulator,
  steps: ChatTurnAgentStep[]
): void {
  turn.agentSteps = steps.map((step) => ({ ...step }));
}

export function recordTurnActivityLine(turn: ChatTurnActivityAccumulator, line: string): void {
  if (!isConcreteActivityLine(line)) {
    return;
  }
  const lines = turn.activityLines ?? [];
  if (lines.includes(line)) {
    return;
  }
  turn.activityLines = [...lines, line];
}

export function activityFromAgentSteps(steps: ChatTurnAgentStep[]): {
  todos: ChatTurnActivityTodo[];
  tools: ChatTurnActivityTool[];
  files: ChatTurnActivityFile[];
} {
  const todos: ChatTurnActivityTodo[] = steps.map((step) => ({
    id: `agent-${step.index}-${step.tool}`,
    content: humanizeAgentSummary(step.tool, step.summary),
    status: step.completed ? "completed" : "in_progress"
  }));
  const tools: ChatTurnActivityTool[] = steps.map((step) => ({
    id: `agent-tool-${step.index}`,
    kind: toolKindFromName(step.tool),
    label: humanizeAgentSummary(step.tool, step.summary),
    status: step.completed ? "done" : "active"
  }));
  const files = extractFileChipsFromLabels(steps.map((step) => step.summary));
  return { todos, tools, files };
}

/** Pull `path`-like tokens from status lines for the files toolbar. */
export function extractFileChipsFromLabels(labels: string[]): ChatTurnActivityFile[] {
  const chips: ChatTurnActivityFile[] = [];
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
      const action: ChatTurnActivityFile["action"] = lower.includes("read")
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

export function looksLikeRepoPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) {
    return false;
  }
  return /[\\/]/.test(trimmed) || /\.\w{1,8}$/.test(trimmed);
}

export function formatClockDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${Math.max(1, seconds)}s`;
}

export function formatWorkedForLabel(ms: number): string {
  return `Worked for ${formatClockDuration(ms)}`;
}

export function formatThoughtLabel(thinkingMs?: number): string {
  if (thinkingMs === undefined || thinkingMs < 500) {
    return "Thought";
  }
  return `Thought ${formatClockDuration(thinkingMs)}`;
}

export function hasChatTurnActivity(activity: ChatTurnActivity | undefined): boolean {
  if (!activity) {
    return false;
  }
  return Boolean(
    activity.thinkingText?.trim() ||
      activity.tools.length ||
      activity.files.length ||
      activity.steps?.length
  );
}

/** Labels the completed Cursor-style trail should show (collapsed by default). */
export function completeActivityView(activity: ChatTurnActivity): {
  workedLabel: string;
  thoughtLabel?: string;
  filePaths: string[];
  defaultCollapsed: true;
} {
  return {
    workedLabel: formatWorkedForLabel(activity.durationMs),
    thoughtLabel: activity.thinkingText?.trim() ? formatThoughtLabel(activity.thinkingMs) : undefined,
    filePaths: activity.files.map((file) => file.path),
    defaultCollapsed: true
  };
}

export function buildChatTurnActivity(
  turn: ChatTurnActivityAccumulator,
  now = Date.now()
): ChatTurnActivity | undefined {
  const thinkingText = turn.thinkingText?.trim() ?? "";
  const fromSteps = activityFromAgentSteps(turn.agentSteps ?? []);
  const fromLines = activityFromConcreteLines(turn.activityLines ?? [], fromSteps.tools.length);
  const fromNamed = activityFromNamedFiles(turn.modelMessage);
  const fromFacts = activityFromRepoFacts(turn.modelMessage);

  const tools = markToolsDone([
    ...fromSteps.tools,
    ...fromLines.tools,
    ...fromNamed.tools,
    ...fromFacts.tools
  ]);
  const steps = markTodosCompleted([
    ...fromSteps.todos,
    ...fromLines.todos,
    ...fromNamed.todos,
    ...fromFacts.todos
  ]);
  const files = mergeFiles(fromSteps.files, fromLines.files, fromNamed.files, fromFacts.files);

  if (!thinkingText && tools.length === 0 && files.length === 0 && steps.length === 0) {
    return undefined;
  }

  const durationMs = Math.max(0, now - turn.startedAt);
  const thinkingMs =
    turn.thinkingStartedAt !== undefined
      ? Math.max(0, (turn.thinkingEndedAt ?? now) - turn.thinkingStartedAt)
      : undefined;

  return {
    durationMs,
    ...(thinkingMs !== undefined ? { thinkingMs } : {}),
    ...(thinkingText ? { thinkingText } : {}),
    tools,
    files,
    ...(steps.length ? { steps } : {})
  };
}

export function attachChatTurnActivity(
  message: ChatMessage,
  turn: ChatTurnActivityAccumulator | undefined,
  now = Date.now()
): ChatMessage {
  if (!turn) {
    return message;
  }
  const activity = buildChatTurnActivity(turn, now);
  if (!activity) {
    return message;
  }
  return { ...message, activity };
}

function activityFromConcreteLines(
  lines: string[],
  toolOffset: number
): {
  todos: ChatTurnActivityTodo[];
  tools: ChatTurnActivityTool[];
  files: ChatTurnActivityFile[];
} {
  const concrete = lines.filter(isConcreteActivityLine);
  const todos: ChatTurnActivityTodo[] = concrete.map((line, index) => ({
    id: `line:${toolOffset + index}:${line}`,
    content: line,
    status: "completed"
  }));
  const tools: ChatTurnActivityTool[] = concrete.map((line, index) => ({
    id: `line-tool:${toolOffset + index}`,
    kind: toolKindFromLabel(line),
    label: line,
    status: "done"
  }));
  return { todos, tools, files: extractFileChipsFromLabels(concrete) };
}

function activityFromRepoFacts(query: string | undefined): {
  todos: ChatTurnActivityTodo[];
  tools: ChatTurnActivityTool[];
  files: ChatTurnActivityFile[];
} {
  const label = repoFactActivityLabel(query);
  if (!label) {
    return { todos: [], tools: [], files: [] };
  }
  return {
    todos: [{ id: `repo-fact:${label}`, content: label, status: "completed" }],
    tools: [{ id: "repo-fact-tool", kind: "search", label, status: "done" }],
    files: []
  };
}

function activityFromNamedFiles(query: string | undefined): {
  todos: ChatTurnActivityTodo[];
  tools: ChatTurnActivityTool[];
  files: ChatTurnActivityFile[];
} {
  const named = query ? extractNamedSourceFiles(query) : [];
  if (!named.length) {
    return { todos: [], tools: [], files: [] };
  }
  const todos: ChatTurnActivityTodo[] = named.map((path, index) => ({
    id: `named-file:${index}:${path}`,
    content: `Read \`${path}\``,
    status: "completed"
  }));
  const tools: ChatTurnActivityTool[] = named.map((path, index) => ({
    id: `named-file-tool:${index}`,
    kind: "read",
    label: `Read \`${path}\``,
    status: "done"
  }));
  const files: ChatTurnActivityFile[] = named.map((path) => ({ path, action: "read" as const }));
  return { todos, tools, files };
}

function markToolsDone(tools: ChatTurnActivityTool[]): ChatTurnActivityTool[] {
  const seen = new Set<string>();
  const next: ChatTurnActivityTool[] = [];
  for (const tool of tools) {
    const key = `${tool.kind}:${tool.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push({ ...tool, status: "done" });
  }
  return next;
}

function markTodosCompleted(todos: ChatTurnActivityTodo[]): ChatTurnActivityTodo[] {
  const seen = new Set<string>();
  const next: ChatTurnActivityTodo[] = [];
  for (const todo of todos) {
    if (seen.has(todo.content)) {
      continue;
    }
    seen.add(todo.content);
    next.push({ ...todo, status: "completed" });
  }
  return next;
}

function mergeFiles(
  first: ChatTurnActivityFile[],
  second: ChatTurnActivityFile[],
  third: ChatTurnActivityFile[] = [],
  fourth: ChatTurnActivityFile[] = []
): ChatTurnActivityFile[] {
  const seen = new Set<string>();
  const next: ChatTurnActivityFile[] = [];
  for (const file of [...first, ...second, ...third, ...fourth]) {
    if (seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    next.push(file);
  }
  return next.slice(0, 40);
}

function toolKindFromName(tool: string): ChatTurnActivityTool["kind"] {
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

function toolKindFromLabel(label: string): ChatTurnActivityTool["kind"] {
  const lower = label.toLowerCase();
  if (
    lower.includes("search") ||
    lower.includes("pulling") ||
    lower.includes("reviewing") ||
    lower.includes("looked up") ||
    lower.includes("inventory")
  ) {
    return "search";
  }
  if (lower.includes("read")) {
    return "read";
  }
  if (lower.includes("explor")) {
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
  if (tool.startsWith("search_")) {
    const label =
      tool === "search_slack"
        ? "Slack"
        : tool === "search_jira"
          ? "Jira"
          : tool === "search_teams"
            ? "Teams"
            : tool === "search_notion"
              ? "Notion"
              : tool === "search_confluence"
                ? "Confluence"
                : tool === "search_google_docs"
                  ? "Google Docs"
                  : tool.replace(/^search_/, "");
    const q = trimmed.replace(new RegExp(`^${tool}:\\s*`, "i"), "");
    return q ? `Searched ${label} for \`${q}\`` : `Searched ${label}`;
  }
  return trimmed || tool;
}
