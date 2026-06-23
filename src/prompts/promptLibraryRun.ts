import { parseSlashCommand, type ParsedSlashCommand } from "../context/slashCommands";
import type { QuickActionId } from "../webview/types";

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
  const quickActionId = actionId as QuickActionId | undefined;

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
