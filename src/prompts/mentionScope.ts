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
export function plainChatHistoryContent(message: string, mentions: MentionScopeRef[] = []): string {
  const trimmed = message.trim();
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
