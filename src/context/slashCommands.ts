import type { QuickActionId } from "../webview/types";
import type { IntegrationChatProvider } from "../chat/types";

export type SlashCommandTarget =
  | { kind: "action"; actionId: QuickActionId }
  | { kind: "integration"; provider: IntegrationChatProvider };

export type SlashCommandDef = {
  /** Canonical command token, without the leading slash. */
  name: string;
  /** Alternate tokens that resolve to the same command. */
  aliases: string[];
  target: SlashCommandTarget;
  /** Short label for the typeahead menu. */
  label: string;
  /** One-line description for the typeahead menu. */
  description: string;
};

export type ParsedSlashCommand = {
  def: SlashCommandDef;
  /** Text following the command token. Empty string when only the command was typed. */
  args: string;
};

/** Display tokens for the five quick-action slash commands (empty-state hint). */
export const QUICK_ACTION_SLASH_HINTS = [
  "understandrepo",
  "trace",
  "owner",
  "blast",
  "gaps"
] as const;

const QUICK_ACTION_DISPLAY: Record<QuickActionId, (typeof QUICK_ACTION_SLASH_HINTS)[number]> = {
  "understand-repo": "understandrepo",
  "trace-decision": "trace",
  "find-owner": "owner",
  "blast-radius": "blast",
  "knowledge-gaps": "gaps"
};

/** Token shown in the UI for a quick-action slash command (may differ from canonical `name`). */
export function slashCommandDisplayToken(def: SlashCommandDef): string {
  if (def.target.kind === "action") {
    return QUICK_ACTION_DISPLAY[def.target.actionId];
  }
  return def.name;
}

export function isQuickActionSlashCommand(def: SlashCommandDef): boolean {
  return def.target.kind === "action";
}

/** Text shown in chat history for a slash invocation (preserves /token and args). */
export function slashCommandHistoryContent(def: SlashCommandDef, args: string): string {
  const token = slashCommandDisplayToken(def);
  const trimmed = args.trim();
  return trimmed ? `/${token} ${trimmed}` : `/${token}`;
}

/**
 * Action slash commands (/gaps, /blast, …) resolve to the same `actionId` as QuickActionGrid
 * buttons. Shared behavior (use-case prompts, context fetch, response enrichment) lives in
 * CoopChatSession via resolveEffectiveQuickAction() and chatResponseEnrichment.ts — update
 * those when adding or changing quick-action behavior.
 */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "understand",
    aliases: ["understandrepo", "repo", "architecture", "explain"],
    target: { kind: "action", actionId: "understand-repo" },
    label: "Understand repo",
    description: "Architecture, key systems, and risks"
  },
  {
    name: "trace",
    aliases: ["why", "decision", "history"],
    target: { kind: "action", actionId: "trace-decision" },
    label: "Trace decision",
    description: "Why this code exists — rationale and tradeoffs"
  },
  {
    name: "owner",
    aliases: ["who", "find-owner"],
    target: { kind: "action", actionId: "find-owner" },
    label: "Find owner",
    description: "Who truly owns this area (needs an open file)"
  },
  {
    name: "blast",
    aliases: ["impact", "blast-radius"],
    target: { kind: "action", actionId: "blast-radius" },
    label: "Blast radius",
    description: "Change impact: dependents, APIs, operational risk"
  },
  {
    name: "gaps",
    aliases: ["unknowns", "knowledge-gaps"],
    target: { kind: "action", actionId: "knowledge-gaps" },
    label: "Knowledge gaps",
    description: "Missing docs, unclear ownership, open questions"
  },
  {
    name: "slack",
    aliases: [],
    target: { kind: "integration", provider: "slack" },
    label: "Slack",
    description: "Answer using Slack discussions as primary evidence"
  },
  {
    name: "jira",
    aliases: [],
    target: { kind: "integration", provider: "jira" },
    label: "Jira",
    description: "Answer using Jira tickets as primary evidence"
  },
  {
    name: "teams",
    aliases: [],
    target: { kind: "integration", provider: "teams" },
    label: "Teams",
    description: "Answer using Microsoft Teams threads as primary evidence"
  },
  {
    name: "confluence",
    aliases: ["wiki"],
    target: { kind: "integration", provider: "confluence" },
    label: "Confluence",
    description: "Answer using Confluence pages as primary evidence"
  },
  {
    name: "notion",
    aliases: [],
    target: { kind: "integration", provider: "notion" },
    label: "Notion",
    description: "Answer using Notion pages as primary evidence"
  },
  {
    name: "docs",
    aliases: ["googledocs", "google-docs"],
    target: { kind: "integration", provider: "google-docs" },
    label: "Google Docs",
    description: "Answer using Google Docs as primary evidence"
  }
];

const COMMAND_BY_TOKEN: Map<string, SlashCommandDef> = (() => {
  const map = new Map<string, SlashCommandDef>();
  for (const def of SLASH_COMMANDS) {
    map.set(def.name, def);
    for (const alias of def.aliases) {
      map.set(alias, def);
    }
  }
  return map;
})();

// Slash commands appear at the start of the message or after whitespace. The token must
// start with a letter and contain only word chars/hyphens, so paths like "/etc/hosts"
// or mid-word slashes ("foo/bar") never match and fall through as normal chat.
const COMMAND_TOKEN_PATTERN = /(?:^|\s)\/([a-z][\w-]*)/gi;

/**
 * Parses the first recognized slash command in raw composer text.
 * Returns null when no known command is present (so it should be sent as normal chat).
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  if (!text) {
    return null;
  }
  const pattern = new RegExp(COMMAND_TOKEN_PATTERN.source, COMMAND_TOKEN_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const def = COMMAND_BY_TOKEN.get(match[1].toLowerCase());
    if (!def) {
      continue;
    }
    const slashPos = match.index + match[0].indexOf("/");
    const afterCommand = slashPos + 1 + match[1].length;
    const rest = text.slice(afterCommand);
    const args = rest.startsWith(" ") ? rest.trimStart() : "";
    return { def, args };
  }
  return null;
}

export type ComposerHighlightSegment =
  | { kind: "text"; text: string }
  | { kind: "slash-command"; text: string };

/** Splits composer text into plain and recognized slash-command spans for inline highlighting. */
export function segmentComposerSlashHighlights(text: string): ComposerHighlightSegment[] {
  if (!text) {
    return [{ kind: "text", text: "" }];
  }

  const segments: ComposerHighlightSegment[] = [];
  const pattern = new RegExp(COMMAND_TOKEN_PATTERN.source, COMMAND_TOKEN_PATTERN.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const tokenName = match[1];
    const def = COMMAND_BY_TOKEN.get(tokenName.toLowerCase());
    if (!def) {
      continue;
    }

    const slashStart = match.index + match[0].indexOf("/");
    const slashToken = text.slice(slashStart, slashStart + 1 + tokenName.length);

    if (slashStart > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, slashStart) });
    }
    segments.push({ kind: "slash-command", text: slashToken });
    lastIndex = slashStart + slashToken.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

/** Partial slash token immediately before `cursor` (start of line or after whitespace). */
export function slashMenuQuery(value: string, cursor?: number): string | null {
  const pos = cursor ?? value.length;
  const before = value.slice(0, pos);
  const match = /(?:^|\s)\/([\w-]*)$/.exec(before);
  return match ? match[1].toLowerCase() : null;
}

/** Replace range for the partial slash token at `cursor` (for typeahead insertion). */
export function slashMenuRange(
  value: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|\s)(\/[\w-]*)$/.exec(before);
  if (!match?.[1]) {
    return null;
  }
  const token = match[1];
  return {
    start: cursor - token.length,
    end: cursor,
    query: token.slice(1).toLowerCase()
  };
}

/** Filters commands for the typeahead menu by token/alias prefix. */
export function matchSlashCommands(query: string): SlashCommandDef[] {
  const normalized = query.toLowerCase();
  if (!normalized) {
    return [...SLASH_COMMANDS];
  }
  return SLASH_COMMANDS.filter(
    (def) =>
      def.name.startsWith(normalized) || def.aliases.some((alias) => alias.startsWith(normalized))
  );
}
