import * as vscode from "vscode";
import { enrichRepoContextWithEditorState } from "./editorManifestContext";
import { resolveEditorFile } from "./editorFileContext";
import { toRepositoryRelativePath } from "./repoFilePath";
import type { RepoContext, UserPreferences } from "../chat/types";

export enum UserIntent {
  QUICK_ACTION_CLICKED = "quick_action_clicked",
  MANUAL_CHAT_SUBMIT = "manual_chat_submit",
  HOTKEY_TRIGGERED = "hotkey_triggered",
  FILE_SWITCHED = "file_switched",
  EDITOR_OPENED = "editor_opened",
  KEYSTROKE = "keystroke",
  MOUSE_HOVER = "mouse_hover",
  SELECTION_CHANGE = "selection_change"
}

export type IntentCost = "free" | "cheap" | "expensive";

export type IntentLineRange = {
  start: number;
  end: number;
};

export type IntentEventContext = {
  file?: string;
  fileSource?: RepoContext["fileSource"];
  contextWarning?: string;
  lines?: IntentLineRange;
  repoId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  languageId?: string;
  openEditors?: string[];
  selectedSymbol?: string;
  /** User message text for manifest scoring at query time. */
  queryText?: string;
  /** Slash-command integration source (/jira, /slack, …) requesting live fetch. */
  integrationProvider?: import("../chat/types").IntegrationChatProvider;
  buttonClicked?: string;
  source?: "editor" | "webview" | "command" | "test";
};

export interface IntentEvent {
  id: string;
  intent: UserIntent;
  timestamp: Date;
  context: IntentEventContext;
  costEstimate: IntentCost;
}

export type ContextRequestType =
  | "file_metadata"
  | "ownership"
  | "blame"
  | "dependencies"
  | "decision_history"
  | "knowledge_gaps"
  | "chat_context";

export type IntentDetectionOptions = {
  source?: IntentEventContext["source"];
  now?: Date;
  idFactory?: () => string;
  integrationProvider?: IntentEventContext["integrationProvider"];
};

const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|go|py|rb|java|kt|cs|rs|php|swift|m|mm|c|cc|cpp|h|hpp)$/i;

const EXPENSIVE_ACTIONS = new Set(["blast-radius", "knowledge-gaps", "understand-repo"]);
const OWNER_ACTIONS = new Set(["find-owner"]);
const TRACE_ACTIONS = new Set(["trace-decision"]);

export class IntentDetector {
  private previousFile?: string;
  private sequence = 0;

  public create(
    intent: UserIntent,
    context: IntentEventContext = {},
    options: IntentDetectionOptions = {}
  ): IntentEvent {
    return {
      id: options.idFactory?.() ?? this.nextId(intent),
      intent,
      timestamp: options.now ?? new Date(),
      context: normalizeContext({
        ...context,
        source: context.source ?? options.source
      }),
      costEstimate: estimateCost(intent, context)
    };
  }

  public fromEditor(
    intent: UserIntent.FILE_SWITCHED | UserIntent.EDITOR_OPENED | UserIntent.SELECTION_CHANGE,
    editor: vscode.TextEditor | undefined,
    preferences: Pick<UserPreferences, "includeActiveFile" | "includeSelection" | "owner" | "repo" | "branch">,
    options: IntentDetectionOptions = {}
  ): IntentEvent {
    const repoContext = repoContextFromEditor(editor, preferences);
    const event = this.create(intent, repoContextToIntentContext(repoContext), {
      ...options,
      source: options.source ?? "editor"
    });
    this.previousFile = repoContext.file;
    return event;
  }

  public detectEditorIntent(
    editor: vscode.TextEditor | undefined
  ): UserIntent.FILE_SWITCHED | UserIntent.EDITOR_OPENED | UserIntent.SELECTION_CHANGE {
    if (!editor) {
      return UserIntent.EDITOR_OPENED;
    }
    const file = vscode.workspace.asRelativePath(editor.document.uri);
    if (!this.previousFile) {
      this.previousFile = file;
      return UserIntent.EDITOR_OPENED;
    }
    if (file !== this.previousFile) {
      this.previousFile = file;
      return UserIntent.FILE_SWITCHED;
    }
    return UserIntent.SELECTION_CHANGE;
  }

  public fromQuickAction(
    actionId: string,
    context: RepoContext,
    queryText?: string,
    options: IntentDetectionOptions = {}
  ): IntentEvent {
    return this.create(
      UserIntent.QUICK_ACTION_CLICKED,
      {
        ...repoContextToIntentContext(context),
        queryText: emptyToUndefined(queryText),
        buttonClicked: actionId,
        source: options.source ?? "webview"
      },
      options
    );
  }

  public fromManualChatSubmit(
    context: RepoContext,
    queryText?: string,
    options: IntentDetectionOptions = {}
  ): IntentEvent {
    return this.create(
      UserIntent.MANUAL_CHAT_SUBMIT,
      {
        ...repoContextToIntentContext(context),
        queryText: emptyToUndefined(queryText),
        integrationProvider: options.integrationProvider,
        source: options.source ?? "webview"
      },
      options
    );
  }

  public fromHotkey(context: RepoContext, command: string, options: IntentDetectionOptions = {}): IntentEvent {
    return this.create(
      UserIntent.HOTKEY_TRIGGERED,
      {
        ...repoContextToIntentContext(context),
        buttonClicked: command,
        source: options.source ?? "command"
      },
      options
    );
  }

  private nextId(intent: UserIntent): string {
    this.sequence += 1;
    return `${intent}-${Date.now()}-${this.sequence}`;
  }
}

export function repoContextFromEditor(
  editor: vscode.TextEditor | undefined,
  preferences: Pick<UserPreferences, "includeActiveFile" | "includeSelection" | "owner" | "repo" | "branch">,
  previous: RepoContext = {}
): RepoContext {
  if (!editor) {
    return {
      owner: preferences.owner || previous.owner || undefined,
      repo: preferences.repo || previous.repo || undefined,
      branch: preferences.branch || previous.branch || undefined
    };
  }

  const selection = editor.selection;
  const next: RepoContext = {
    owner: preferences.owner || previous.owner || undefined,
    repo: preferences.repo || previous.repo || undefined,
    branch: preferences.branch || previous.branch || undefined,
    languageId: editor.document.languageId
  };

  if (preferences.includeActiveFile) {
    const resolved = resolveEditorFile(editor);
    next.file = resolved.file;
    next.fileSource = resolved.fileSource;
    next.contextWarning = resolved.warning;
    if (resolved.owner && resolved.repo) {
      next.owner = resolved.owner;
      next.repo = resolved.repo;
    }
  }

  if (preferences.includeSelection) {
    next.selectedLines = selection.isEmpty
      ? undefined
      : [selection.start.line + 1, selection.end.line + 1];
  }

  return enrichRepoContextWithEditorState(next, editor);
}

export function repoContextToIntentContext(context: RepoContext): IntentEventContext {
  return normalizeContext({
    file: context.file,
    fileSource: context.fileSource,
    contextWarning: context.contextWarning,
    lines: context.selectedLines
      ? {
          start: context.selectedLines[0],
          end: context.selectedLines[1]
        }
      : undefined,
    owner: context.owner,
    repo: context.repo,
    branch: context.branch,
    repoId: repoIdFromContext(context),
    languageId: context.languageId,
    openEditors: context.openEditors,
    selectedSymbol: context.selectedSymbol
  });
}

export function intentContextToRepoContext(context: IntentEventContext): RepoContext {
  return {
    owner: context.owner,
    repo: context.repo,
    branch: context.branch,
    file: context.file,
    fileSource: context.fileSource,
    contextWarning: context.contextWarning,
    selectedLines: context.lines ? [context.lines.start, context.lines.end] : undefined,
    languageId: context.languageId,
    openEditors: context.openEditors,
    selectedSymbol: context.selectedSymbol
  };
}

export function estimateCost(intent: UserIntent, context: IntentEventContext = {}): IntentCost {
  if (intent === UserIntent.KEYSTROKE || intent === UserIntent.MOUSE_HOVER) {
    return "free";
  }
  if (intent === UserIntent.FILE_SWITCHED || intent === UserIntent.EDITOR_OPENED) {
    return "cheap";
  }
  if (intent === UserIntent.SELECTION_CHANGE) {
    return context.lines ? "cheap" : "free";
  }
  if (intent === UserIntent.MANUAL_CHAT_SUBMIT || intent === UserIntent.HOTKEY_TRIGGERED) {
    return "expensive";
  }
  const action = context.buttonClicked;
  if (!action) {
    return "expensive";
  }
  if (EXPENSIVE_ACTIONS.has(action)) {
    return "expensive";
  }
  return "cheap";
}

export function requestTypesForIntent(event: IntentEvent): ContextRequestType[] {
  const action = event.context.buttonClicked;
  if (event.intent === UserIntent.KEYSTROKE || event.intent === UserIntent.MOUSE_HOVER) {
    return [];
  }
  if (event.intent === UserIntent.FILE_SWITCHED || event.intent === UserIntent.EDITOR_OPENED) {
    return ["file_metadata"];
  }
  if (event.intent === UserIntent.SELECTION_CHANGE) {
    return event.context.lines ? ["blame"] : [];
  }
  if (event.intent === UserIntent.MANUAL_CHAT_SUBMIT || event.intent === UserIntent.HOTKEY_TRIGGERED) {
    return ["chat_context"];
  }
  if (!action) {
    return ["chat_context"];
  }
  if (TRACE_ACTIONS.has(action)) {
    return ["decision_history", "blame"];
  }
  if (OWNER_ACTIONS.has(action)) {
    return ["file_metadata", "ownership"];
  }
  if (action === "blast-radius") {
    return ["file_metadata", "dependencies"];
  }
  if (action === "knowledge-gaps") {
    return ["file_metadata", "ownership", "dependencies", "knowledge_gaps"];
  }
  if (action === "understand-repo") {
    return ["file_metadata", "ownership", "dependencies"];
  }
  return ["chat_context"];
}

export function isBlockedIntent(intent: UserIntent): boolean {
  return intent === UserIntent.KEYSTROKE || intent === UserIntent.MOUSE_HOVER;
}

export function shouldLightFetchSelection(event: IntentEvent): boolean {
  return event.intent === UserIntent.SELECTION_CHANGE && Boolean(event.context.file && event.context.lines);
}

export function isCodeFile(file: string | undefined): boolean {
  return Boolean(file && CODE_FILE_PATTERN.test(file));
}

export function repoIdFromContext(context: Pick<RepoContext, "owner" | "repo">): string | undefined {
  return context.owner && context.repo ? `${context.owner}/${context.repo}` : undefined;
}

export function normalizeContext(context: IntentEventContext): IntentEventContext {
  const file = context.file?.replace(/\\/g, "/");
  const lines = context.lines
    ? {
        start: Math.max(1, Math.min(context.lines.start, context.lines.end)),
        end: Math.max(1, Math.max(context.lines.start, context.lines.end))
      }
    : undefined;
  const owner = emptyToUndefined(context.owner);
  const repo = emptyToUndefined(context.repo);
  return {
    ...context,
    file: file ? toRepositoryRelativePath(file) : undefined,
    owner,
    repo,
    branch: emptyToUndefined(context.branch),
    languageId: emptyToUndefined(context.languageId),
    repoId: context.repoId || (owner && repo ? `${owner}/${repo}` : undefined),
    openEditors: context.openEditors?.map((path) => toRepositoryRelativePath(path)),
    selectedSymbol: emptyToUndefined(context.selectedSymbol),
    queryText: emptyToUndefined(context.queryText),
    lines
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
