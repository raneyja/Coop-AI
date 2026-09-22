import type { RepoContext, RepoContextFileSource } from "../chat/types";
import type { ChatIntentJob, ChatIntentPlan, ChatIntentTask } from "../chat/intentPlanner/types";
import {
  isRemoteChip,
  isSameRepoFilePath,
  shouldKeepRemoteProvenance
} from "./fileChipIdentity";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

/**
 * L vs R for one turn.
 * Call this only after remote provenance is applied. A same-path clone tab is
 * `fileSource: "remote"` and must stay indexed-repo. Do not key this off URI scheme.
 */
export function isFileAssistantSession(
  ctx: Pick<RepoContext, "file" | "fileSource"> | undefined
): boolean {
  if (!ctx?.file?.trim()) {
    return false;
  }
  return !isRemoteChip(ctx);
}

export type SessionMode = "file-assistant" | "indexed-repo";

/**
 * L turns never load Use-repo AGENTS.md. A personal upload still loads.
 * Use-repo with no L file keeps the repo file.
 */
export function projectInstructionsSourcesForTurn(input: {
  fileAssistant: boolean;
  useRepoId?: string;
  attachedAgentsMdPath?: string;
}): { useRepoId?: string; attachedAgentsMdPath?: string } {
  if (input.fileAssistant) {
    const attached = input.attachedAgentsMdPath?.trim();
    return attached ? { attachedAgentsMdPath: attached } : {};
  }
  const repoId = input.useRepoId?.trim();
  if (repoId) {
    return { useRepoId: repoId };
  }
  const attached = input.attachedAgentsMdPath?.trim();
  return attached ? { attachedAgentsMdPath: attached } : {};
}

export function sessionModeForContext(
  ctx: Pick<RepoContext, "file" | "fileSource"> | undefined
): SessionMode {
  return isFileAssistantSession(ctx) ? "file-assistant" : "indexed-repo";
}

/**
 * Same-path local clone stays the remote pin. A different path stays the incoming stamp.
 * Detector input for tests and autocomplete — not a second attach path.
 */
export function contextAfterRemoteProvenance(
  existing: Pick<RepoContext, "file" | "fileSource">,
  incoming: Pick<RepoContext, "file" | "fileSource">
): Pick<RepoContext, "file" | "fileSource"> {
  if (shouldKeepRemoteProvenance(existing, incoming)) {
    return { file: existing.file, fileSource: "remote" };
  }
  return incoming;
}

export type ExplicitEditorChipDecision = "ignore" | "chip-local" | "keep-remote";

/**
 * New Chat leaves passive snap off so an already-open tab does not jump onto a blank chat.
 * Only an explicit editor activation may chip. A same-path clone of the remote pin stays R,
 * including during the post-remote suppress window.
 */
export function decideExplicitEditorChip(input: {
  userActivatedEditor: boolean;
  incomingFile?: string;
  incomingFileSource?: RepoContextFileSource;
  currentFile?: string;
  currentIsRemote: boolean;
}): ExplicitEditorChipDecision {
  if (!input.userActivatedEditor || !input.incomingFile?.trim()) {
    return "ignore";
  }
  const samePathClone =
    input.currentIsRemote &&
    input.incomingFileSource !== "remote" &&
    input.incomingFileSource !== "external" &&
    !isOsAbsoluteDiskPath(input.incomingFile) &&
    Boolean(input.currentFile?.trim()) &&
    isSameRepoFilePath(input.incomingFile, input.currentFile);
  if (samePathClone) {
    return "keep-remote";
  }
  return "chip-local";
}

/** Autocomplete graph follows the session, not the URI scheme. */
export function documentIsFileAssistant(input: {
  file?: string;
  fileSource?: RepoContextFileSource;
  remotePinFile?: string;
}): boolean {
  const pin = input.remotePinFile?.trim();
  const stamped =
    pin && input.file?.trim()
      ? contextAfterRemoteProvenance(
          { file: pin, fileSource: "remote" },
          { file: input.file, fileSource: input.fileSource }
        )
      : { file: input.file, fileSource: input.fileSource };
  return isFileAssistantSession(stamped);
}

export function autocompleteAllowsGraph(input: {
  file?: string;
  fileSource?: RepoContextFileSource;
  remotePinFile?: string;
}): boolean {
  return !documentIsFileAssistant(input);
}

/** True when the completion request should include useGraphContext. */
export function completionRequestsGraphContext(options: {
  allowGraphContext?: boolean;
  effectiveUseGraph: boolean;
}): boolean {
  if (options.allowGraphContext === false) {
    return false;
  }
  return options.effectiveUseGraph;
}

/** Locate and code-host hunts belong to indexed-repo. Named Slack/Jira/docs jobs stay. */
export function jobsKeptOnFileAssistantTurn(jobs: ChatIntentJob[] | undefined): ChatIntentJob[] {
  return (jobs ?? []).filter((job) => !isRepoHuntCapability(job.capability));
}

function isRepoHuntCapability(capability: string | undefined): boolean {
  return capability === "locate" || capability === "code-host";
}

function isRepoHuntTask(task: ChatIntentTask): boolean {
  return (
    isRepoHuntCapability(task.job) || task.kind === "search-repo" || task.kind === "search-code-host"
  );
}

/**
 * L turns keep named tools and drop repo workflows / hunts.
 * Locate and code-host jobs are cleared here so every L caller drops them.
 * Indexed-repo plans are not passed through here.
 */
export function applyFileAssistantIntentPlan(plan: ChatIntentPlan): ChatIntentPlan {
  const tools = plan.tools ?? [];
  const jobs = jobsKeptOnFileAssistantTurn(plan.jobs);
  const droppedTaskIds = new Set(
    (plan.tasks ?? []).filter((task) => isRepoHuntTask(task)).map((task) => task.id)
  );
  const tasks = plan.tasks?.filter((task) => !isRepoHuntTask(task));
  const todos = plan.todos?.filter(
    (todo) => !droppedTaskIds.has(todo.id) && todo.id !== "locate-repo" && todo.id !== "code-host"
  );
  return {
    ...plan,
    workflow: undefined,
    execution: "none",
    mode: tools.length > 0 ? "tools-only" : plan.mode === "none" ? "none" : "plain",
    codeIntent: {
      action: "none",
      confidence: "high",
      reason: "file-assistant — open file only"
    },
    jobs,
    ...(tasks !== undefined ? { tasks } : {}),
    ...(todos !== undefined ? { todos } : {})
  };
}
