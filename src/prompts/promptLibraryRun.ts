import { parseSlashCommand, type ParsedSlashCommand } from "../context/slashCommands";
import { isQuickActionId, type QuickActionId } from "../webview/types";

/** Defensive caps for workspace-provided prompt files (untrusted on-disk content). */
export const MAX_WORKSPACE_PROMPTS = 200;
export const MAX_WORKSPACE_TEMPLATE_CHARS = 20_000;

export type PromptLibraryRunPlan =
  | { kind: "chat"; message: string }
  | { kind: "slash"; parsed: ParsedSlashCommand }
  | { kind: "quick-action"; actionId: QuickActionId; slashUserArgs?: string };

/**
 * Routes a saved prompt template to chat, slash, or quick-action pipelines.
 * When `actionId` is set, custom template text becomes user intent (slashUserArgs),
 * not a replacement for the default model prompt.
 */
export function resolvePromptLibraryRun(template: string, actionId?: string): PromptLibraryRunPlan {
  const trimmed = template.trim();
  // Validate against the known set instead of a blind cast — an unknown actionId
  // falls through to slash/chat routing rather than forging an invalid quick action.
  const quickActionId = isQuickActionId(actionId) ? actionId : undefined;

  if (quickActionId) {
    const parsed = parseSlashCommand(trimmed);
    if (parsed?.def.target.kind === "action" && parsed.def.target.actionId === quickActionId) {
      const args = parsed.args.trim();
      return { kind: "quick-action", actionId: quickActionId, slashUserArgs: args || undefined };
    }
    return { kind: "quick-action", actionId: quickActionId, slashUserArgs: trimmed || undefined };
  }

  const parsed = parseSlashCommand(trimmed);
  if (parsed) {
    return { kind: "slash", parsed };
  }
  return { kind: "chat", message: trimmed };
}

type SanitizedPromptEntry = {
  id: string;
  title: string;
  template: string;
  actionId?: string;
  scope?: "workspace";
};

/**
 * Defensively bound workspace prompt files: keep only well-formed entries, cap the
 * total count, and truncate oversized templates so a malformed/huge on-disk file
 * cannot blow up the prompt payload.
 */
export function sanitizeWorkspacePromptEntries<T extends SanitizedPromptEntry>(entries: T[]): T[] {
  return entries
    .filter((entry) => entry.id && entry.title && entry.template)
    .slice(0, MAX_WORKSPACE_PROMPTS)
    .map((entry) => {
      const template =
        entry.template.length > MAX_WORKSPACE_TEMPLATE_CHARS
          ? entry.template.slice(0, MAX_WORKSPACE_TEMPLATE_CHARS)
          : entry.template;
      // Drop invalid actionIds so they cannot persist in .coop/prompts.json and
      // silently fall through to chat/slash at resolve time.
      if (entry.actionId !== undefined && !isQuickActionId(entry.actionId)) {
        const { actionId: _dropped, ...rest } = entry;
        return { ...rest, template } as T;
      }
      return template === entry.template ? entry : ({ ...entry, template } as T);
    });
}

export function mergeComposerWithPromptTemplate(composerText: string | undefined, template: string): string {
  const prefix = composerText?.trim();
  const body = template.trim();
  if (prefix && body) {
    return `${prefix}\n\n${body}`;
  }
  return prefix || body;
}

export function applyPromptTemplate(
  template: string,
  variables: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
}

export function promptVariablesFromContext(context: {
  file?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  selectedLines?: [number, number];
}): Record<string, string | undefined> {
  const lines =
    context.selectedLines && context.selectedLines.length === 2
      ? `${context.selectedLines[0]}-${context.selectedLines[1]}`
      : undefined;
  return {
    file: context.file,
    lines,
    owner: context.owner,
    repo: context.repo,
    branch: context.branch
  };
}
