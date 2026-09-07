import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { WORKSPACE_LOCAL_REPO_ID } from "../chat/mentionSearchMerge";

/** Max @ attachments per composer turn — aligned with ChatComposer MAX_MENTIONS. */
export const MENTION_ATTACHMENT_BUDGET = 3;

export type MentionScopeRef = {
  path: string;
  repoId?: string;
  source?: "local" | "indexed";
};

export type MentionRepoScope = {
  inRepo: MentionScopeRef[];
  outOfRepo: MentionScopeRef[];
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/** True when a path plausibly lives inside the target repo tree from the evidence bundle. */
export function pathLikelyInTargetRepo(path: string, summary?: RepoSummaryEvidence): boolean {
  const normalized = normalizePath(path);
  if (!normalized) {
    return false;
  }

  const segments = normalized.split("/");
  const top = segments[0];
  if (!top) {
    return false;
  }

  const anchorPaths = (summary?.entryFiles ?? []).map((file) => normalizePath(file.path));
  if (anchorPaths.some((anchor) => anchor === normalized || normalized.startsWith(`${anchor}/`))) {
    return true;
  }

  const manifestEntries = summary?.manifest?.entryPoints ?? [];
  if (manifestEntries.some((entry) => normalizePath(entry) === normalized)) {
    return true;
  }

  const tree = summary?.treeOverview as
    | {
        topLevelDirs?: string[];
        topLevelFiles?: string[];
        srcEntries?: { topLevelDirs?: string[]; topLevelFiles?: string[] };
      }
    | undefined;

  if (!tree) {
    return false;
  }

  const rootFiles = (tree.topLevelFiles ?? []).map(normalizePath);
  if (rootFiles.includes(normalized)) {
    return true;
  }

  const topLevelDirs = (tree.topLevelDirs ?? []).map((dir) => normalizePath(dir).replace(/\/$/, ""));
  if (topLevelDirs.includes(top)) {
    return true;
  }

  for (const dir of topLevelDirs) {
    if (normalized === dir || normalized.startsWith(`${dir}/`)) {
      return true;
    }
  }

  const srcEntries = tree.srcEntries;
  if (top === "src" && srcEntries) {
    const srcDirs = (srcEntries.topLevelDirs ?? []).map((dir) => normalizePath(dir).replace(/\/$/, ""));
    const srcFiles = (srcEntries.topLevelFiles ?? []).map(normalizePath);
    const inner = segments.slice(1);
    if (inner.length === 0) {
      return true;
    }
    const innerTop = inner[0];
    if (srcFiles.includes(inner.join("/"))) {
      return true;
    }
    if (innerTop && srcDirs.includes(innerTop)) {
      return true;
    }
    for (const dir of srcDirs) {
      const remainder = inner.join("/");
      if (remainder === dir || remainder.startsWith(`${dir}/`)) {
        return true;
      }
    }
  }

  return false;
}

/** Trace Decision: local workspace and foreign-repo @ files are never part of the timeline. */
export function partitionMentionsForTraceDecision(
  mentions: MentionScopeRef[],
  activeRepoId?: string
): MentionRepoScope {
  const inRepo: MentionScopeRef[] = [];
  const outOfRepo: MentionScopeRef[] = [];

  for (const mention of mentions) {
    if (isLocalWorkspaceMention(mention)) {
      outOfRepo.push(mention);
      continue;
    }
    const sameRepoId =
      !mention.repoId ||
      !activeRepoId ||
      mention.repoId.toLowerCase() === activeRepoId.toLowerCase();
    if (sameRepoId) {
      inRepo.push(mention);
    } else {
      outOfRepo.push(mention);
    }
  }

  return { inRepo, outOfRepo };
}

export type MentionScopeQuickAction =
  | import("../webview/types").QuickActionId
  | "integration";

/** Stable key for matching composer mentions to scope partitions. */
export function mentionAttachmentKey(mention: { path: string; repoId?: string }): string {
  return `${mention.repoId ?? ""}:${mention.path}`;
}

/** Unified @-attachment scope for quick actions, slash aliases, and integration slash routes. */
export function partitionMentionsForQuickAction(
  actionId: MentionScopeQuickAction,
  mentions: MentionScopeRef[],
  options: {
    activeRepoId?: string;
    owner?: string;
    repo?: string;
    repoSummary?: RepoSummaryEvidence;
  }
): MentionRepoScope {
  switch (actionId) {
    case "understand-repo":
      return partitionMentionsForRepoSummary(mentions, options.repoSummary, options.activeRepoId);
    case "find-owner":
      return partitionMentionsForOwnership(
        mentions,
        { owner: options.owner ?? "unknown", repo: options.repo ?? "unknown" },
        options.activeRepoId
      );
    case "trace-decision":
    case "blast-radius":
    case "knowledge-gaps":
    case "integration":
      return partitionMentionsForTraceDecision(mentions, options.activeRepoId);
  }
}

export function filterMentionsByInScopeKeys<T extends { path: string; repoId?: string }>(
  mentions: T[],
  inScopeKeys: Set<string>
): T[] {
  return mentions.filter((mention) => inScopeKeys.has(mentionAttachmentKey(mention)));
}

export function partitionMentionsForOwnership(
  mentions: MentionScopeRef[],
  report: { owner: string; repo: string },
  activeRepoId?: string
): MentionRepoScope {
  const inRepo: MentionScopeRef[] = [];
  const outOfRepo: MentionScopeRef[] = [];

  for (const mention of mentions) {
    if (isLocalWorkspaceMention(mention)) {
      outOfRepo.push(mention);
      continue;
    }
    const sameRepoId =
      !mention.repoId ||
      !activeRepoId ||
      mention.repoId.toLowerCase() === activeRepoId.toLowerCase();

    if (sameRepoId) {
      inRepo.push(mention);
    } else {
      outOfRepo.push(mention);
    }
  }

  return { inRepo, outOfRepo };
}

/** True when any @ attachment is outside the active repo (foreign repo or local workspace). */
export function mentionsHaveOutOfScopeForActiveRepo(
  mentions: MentionScopeRef[],
  activeRepoId?: string
): boolean {
  if (!mentions.length) {
    return false;
  }
  return partitionMentionsForTraceDecision(mentions, activeRepoId).outOfRepo.length > 0;
}

/** True when every @ attachment is outside the active repo (none in scope). */
export function allMentionsOutOfScopeForActiveRepo(
  mentions: MentionScopeRef[],
  activeRepoId?: string
): boolean {
  if (!mentions.length) {
    return false;
  }
  const scope = partitionMentionsForTraceDecision(mentions, activeRepoId);
  return scope.inRepo.length === 0 && scope.outOfRepo.length > 0;
}

/** User message language that refers to an @-attached file ("this file", etc.). */
export function plainChatRefersToAttachedFile(message: string): boolean {
  return /\b(this file|the file|that file|attached file|the attached)\b/i.test(message) ||
    /\bwhat does (it|this|that) do\b/i.test(message) ||
    /\bexplain (it|this file|that file)\b/i.test(message);
}

/** Chat bubble text for plain chat — preserves @ attachment chips in history. */
export type PlainChatHistoryContext = {
  file?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  /** Explorer Use-repo. Prefs-only owner/repo must not stamp chips. */
  scope?: "repo" | "file";
  /** 1-based inclusive editor highlight — stamped like file/repo chips. */
  selectedLines?: [number, number];
};

/** Repo/branch chips only for Use-repo or a file bound to owner/repo. */
function shouldStampRepoChips(context: PlainChatHistoryContext | undefined): boolean {
  if (!context?.owner?.trim() || !context?.repo?.trim()) {
    return false;
  }
  if (context.file?.trim()) {
    return true;
  }
  return context.scope === "repo";
}

export type PlainChatHistoryOptions = {
  /** Active repo/file scope for the turn. */
  context?: PlainChatHistoryContext;
  /**
   * When true, append file/repo/branch/selection chips in the same compact
   * format as quick actions. Prefer true for every user turn so follow-ups
   * show the same scope subtitle as the first message.
   */
  includeContextChips?: boolean;
};

/** Display label for a 1-based inclusive selection (matches composer preview chips). */
export function formatSelectedLinesChip(selectedLines: [number, number]): string {
  const [start, end] = selectedLines;
  return start === end ? `L${start}` : `L${start}–${end}`;
}

/** Context chips shown under chat bubbles (mirrors quick-action format). */
export function plainChatContextChips(
  context: PlainChatHistoryContext | undefined,
  mentions: MentionScopeRef[] = []
): Array<{ key: string; value: string }> {
  const chips: Array<{ key: string; value: string }> = [];
  const file = context?.file?.trim();
  if (file) {
    chips.push({ key: "file", value: file });
  }
  if (context?.selectedLines && context.selectedLines.length === 2) {
    chips.push({ key: "selection", value: formatSelectedLinesChip(context.selectedLines) });
  }
  if (shouldStampRepoChips(context) && context?.owner?.trim() && context?.repo?.trim()) {
    chips.push({ key: "repo", value: `${context.owner.trim()}/${context.repo.trim()}` });
    if (context.branch?.trim()) {
      chips.push({ key: "branch", value: context.branch.trim() });
    }
  }
  if (mentions.length) {
    chips.push({ key: "attached", value: mentionDisplayPaths(mentions) });
  }
  return chips;
}

export function formatContextChipLine(
  context: PlainChatHistoryContext | undefined,
  mentions: MentionScopeRef[] = []
): string | undefined {
  const chips = plainChatContextChips(context, mentions);
  if (chips.length === 0) {
    return undefined;
  }
  return chips.map((chip) => `${chip.key}: ${chip.value}`).join(" · ");
}

/**
 * Append (or replace) a trailing compact context-chip line so file + selection
 * stay visible on /edit and highlight turns.
 */
export function withContextChipLine(
  message: string,
  context: PlainChatHistoryContext | undefined,
  mentions: MentionScopeRef[] = []
): string {
  const trimmed = message.trim();
  const chipLine = formatContextChipLine(context, mentions);
  if (!chipLine) {
    return trimmed;
  }

  const newline = trimmed.indexOf("\n");
  if (newline === -1) {
    return `${trimmed}\n${chipLine}`;
  }

  const head = trimmed.slice(0, newline).trim();
  const rest = trimmed.slice(newline + 1).trim();
  // Replace an existing compact chip footer; keep multi-line user prose intact.
  if (!rest || isCompactContextChipLine(rest) || /^attached:\s+/i.test(rest)) {
    return `${head}\n${chipLine}`;
  }
  return `${trimmed}\n${chipLine}`;
}

/** True when history already has a scope subtitle (repo/file/branch/selection). */
export function historyContentHasScopeChips(content: string): boolean {
  const trimmed = content.trim();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) {
    return false;
  }
  const rest = trimmed.slice(newline + 1).trim();
  if (!rest) {
    return false;
  }
  if (!isCompactContextChipLine(rest) && !/^attached:\s+/i.test(rest)) {
    return false;
  }
  return /\b(repo|file|branch|selection|lines):\s+/i.test(rest);
}

function isCompactContextChipLine(line: string): boolean {
  return /^[\w ]+: .+( · [\w ]+: .+)*$/.test(line.trim());
}

export function plainChatHistoryContent(
  message: string,
  mentions: MentionScopeRef[] = [],
  options?: PlainChatHistoryOptions
): string {
  const trimmed = message.trim();
  if (options?.includeContextChips) {
    return withContextChipLine(trimmed, options.context, mentions);
  }
  if (!mentions.length) {
    return trimmed;
  }
  const attached = mentionDisplayPaths(mentions);
  return `${trimmed}\nattached: ${attached}`;
}

export function partitionMentionsForRepoSummary(
  mentions: MentionScopeRef[],
  summary: RepoSummaryEvidence | undefined,
  activeRepoId?: string
): MentionRepoScope {
  const inRepo: MentionScopeRef[] = [];
  const outOfRepo: MentionScopeRef[] = [];

  for (const mention of mentions) {
    const sameRepoId =
      !mention.repoId ||
      !activeRepoId ||
      mention.repoId.toLowerCase() === activeRepoId.toLowerCase();
    const inTree = pathLikelyInTargetRepo(mention.path, summary);

    if (sameRepoId && inTree) {
      inRepo.push(mention);
    } else {
      outOfRepo.push(mention);
    }
  }

  return { inRepo, outOfRepo };
}

export function mentionDisplayPath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  return parts.slice(-2).join("/");
}

export function isLocalWorkspaceMention(mention: MentionScopeRef): boolean {
  return mention.source === "local" || mention.repoId === WORKSPACE_LOCAL_REPO_ID;
}

/** Bubble / chip label for an @ attachment. */
export function mentionAttachmentLabel(mention: MentionScopeRef): string {
  const path = mentionDisplayPath(mention.path);
  return isLocalWorkspaceMention(mention) ? `${path} (local workspace)` : path;
}

export function mentionDisplayPaths(mentions: MentionScopeRef[]): string {
  return mentions.map((mention) => mentionAttachmentLabel(mention)).join(", ");
}

export type MentionScopePromptConfig = {
  targetLabel: string;
  scope: MentionRepoScope;
  /** Lead-in for in-repo paths, e.g. "may weight these paths". */
  inScopeInstruction: string;
  /** Section to exclude out-of-repo paths from, e.g. "Architecture / Key subsystems". */
  excludeFromLabel: string;
  /** Alternate quick action to suggest for the other project, e.g. "Understand Repo". */
  alternateActionLabel: string;
};

/** Shared ## @ attachments block for synthesis prompts (all quick actions). */
export function appendMentionScopePromptSection(
  lines: string[],
  config: MentionScopePromptConfig
): void {
  const { targetLabel, scope, inScopeInstruction, excludeFromLabel, alternateActionLabel } = config;
  if (!scope.inRepo.length && !scope.outOfRepo.length) {
    return;
  }

  lines.push("");
  lines.push("## @ attachments");
  if (scope.inRepo.length) {
    lines.push(`- In ${targetLabel} (${inScopeInstruction}): ${mentionDisplayPaths(scope.inRepo)}`);
  }
  if (scope.outOfRepo.length) {
    const paths = mentionDisplayPaths(scope.outOfRepo);
    lines.push(`- **Out of ${targetLabel} — exclude from ${excludeFromLabel}:** ${paths}`);
    lines.push(`  Do not treat these paths as part of ${targetLabel}.`);
    lines.push(
      `  **Required in your response:** Include **Out-of-scope @ attachments** naming ${paths}. State each path was skipped because it is outside ${targetLabel}. Suggest @-mentioning in-repo paths or running ${alternateActionLabel} on that project.`
    );
  } else if (scope.inRepo.length) {
    lines.push(
      `- All listed @ attachments are in scope for ${targetLabel}. **Do not** include an **Out-of-scope @ attachments** section in your response.`
    );
  }
}

/** Standard copy for system prompts — reference in every use case that supports @ attachments. */
export const OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE = `Include **Out-of-scope @ attachments** only when the user message ## @ attachments section lists out-of-repo paths. When all @ files are in scope, or when no @ files were attached, omit that section entirely — never use it to confirm in-scope files.`;
