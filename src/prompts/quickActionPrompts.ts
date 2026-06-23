import type { QuickActionId } from "../webview/types";
import type { RepoContext } from "../chat/types";
import {
  MENTION_ATTACHMENT_BUDGET,
  mentionAttachmentLabel,
  mentionDisplayPaths,
  type MentionScopeRef
} from "./mentionScope";

/**
 * Quick-action grid prompts. Slash aliases for the same actions live in slashCommands.ts;
 * response post-processing and use-case routing are shared via chatResponseEnrichment.ts.
 */

export type QuickActionMentionRef = MentionScopeRef;

const DIRECTIVE = "Be direct and thorough; no preamble, filler, or restating this request.";

export type QuickActionContextChip = {
  key: string;
  value: string;
};

export type QuickActionPromptParts = {
  /** One-line intent shown in the chat bubble. */
  display: string;
  /** Full user turn sent to the model (before synthesis/context wrapping). */
  model: string;
  /** Context keys for compact bubble rendering. */
  chips: QuickActionContextChip[];
};

function repoLabel(ctx: RepoContext): string {
  if (ctx.owner && ctx.repo) {
    return `${ctx.owner}/${ctx.repo}`;
  }
  return "unknown";
}

function branchLabel(ctx: RepoContext): string {
  return ctx.branch || "unknown";
}

function fileLabel(ctx: RepoContext): string {
  return ctx.file || "none";
}

function providerNote(ctx: RepoContext): string {
  if (ctx.provider && ctx.provider !== "github") {
    return `, host ${ctx.provider}`;
  }
  return "";
}

function fileSourceNote(ctx: RepoContext): string {
  if (ctx.fileSource && ctx.fileSource !== "workspace") {
    return `, file source ${ctx.fileSource}`;
  }
  return "";
}

function mentionBasenames(mentions: QuickActionMentionRef[]): string[] {
  return mentions.map((mention) => mentionAttachmentLabel(mention));
}

function mentionChip(mentions: QuickActionMentionRef[]): QuickActionContextChip | undefined {
  if (!mentions.length) {
    return undefined;
  }
  return { key: "attached", value: mentionBasenames(mentions).join(", ") };
}

function mentionPreamble(mentions: QuickActionMentionRef[]): string {
  return `User @-attached files (${mentionDisplayPaths(mentions)}) appear in <mentioned_files>.`;
}

function mentionBudgetRule(mentions: QuickActionMentionRef[]): string {
  if (mentions.length > MENTION_ATTACHMENT_BUDGET) {
    return `With ${mentions.length} @ attachments (budget ${MENTION_ATTACHMENT_BUDGET}), prioritize the active scope — do not attempt equal depth on every path.`;
  }
  return "";
}

const REPO_WIDE_CROSS_ACTION_HINT =
  "When the answer points to a specific file or subsystem, suggest the matching quick action: Trace Decision for decision history, Find Owner for escalation, Blast Radius before editing a hot path, Knowledge Gaps for documentation holes.";

const FIND_OWNER_REPO_WIDE_CROSS_ACTION_HINT =
  "When routing ownership for a subsystem, suggest cross-actions: Understand Repo for architecture context, Trace Decision for evolution history, Blast Radius before changes through a single owner, Knowledge Gaps for undocumented areas.";

function mentionModelGuidance(
  actionId: QuickActionId,
  mentions: QuickActionMentionRef[],
  ctx: RepoContext
): string {
  const repo = repoLabel(ctx);
  const preamble = mentionPreamble(mentions);
  const budgetRule = mentionBudgetRule(mentions);
  switch (actionId) {
    case "understand-repo":
      return [
        preamble,
        budgetRule,
        `Only treat paths that belong to ${repo} as in-scope subsystems — weight those while keeping a repo-wide overview.`,
        `If a path is outside ${repo} (different repo, local workspace file, or foreign project layout), do NOT describe it under Architecture or Key subsystems for ${repo}.`,
        `Add **Out-of-scope @ attachments** only when the synthesis prompt ## @ attachments section lists out-of-repo paths — omit that section when all @ files are in scope.`
      ]
        .filter(Boolean)
        .join(" ");
    case "trace-decision": {
      const file = fileLabel(ctx);
      return [
        preamble,
        budgetRule,
        `The trace target is the primary open file (${file}) — use the decision timeline for that path only.`,
        `In-repo @ paths in ${repo} may supplement the narrative; local workspace or foreign-repo paths are NOT part of ${repo}'s decision timeline.`,
        `Do NOT attribute timeline commits, PRs, or tickets to out-of-scope @ files.`,
        `Add **Out-of-scope @ attachments** only when the synthesis prompt ## @ attachments section lists out-of-repo paths — omit that section when all @ files are in scope.`
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "find-owner":
      return [
        preamble,
        budgetRule,
        ctx.file?.trim()
          ? `Include ownership for in-repo paths alongside the active file in ${repo}.`
          : `Map repository-wide ownership for ${repo} — top committers, CODEOWNERS teams, and escalation paths.`,
        `If a path is outside ${repo} (different repo, local workspace file, or foreign project layout), do NOT attribute ${repo} owners to it.`,
        `Add **Out-of-scope @ attachments** only when the synthesis prompt ## @ attachments section lists out-of-repo paths — omit that section when all @ files are in scope.`
      ]
        .filter(Boolean)
        .join(" ");
    case "blast-radius": {
      const file = fileLabel(ctx);
      return [
        preamble,
        budgetRule,
        `The blast-radius target is the primary open file (${file}) — analyze impact for that path first.`,
        `In-repo @ paths in ${repo} may add blast surfaces; local workspace or foreign-repo paths are NOT part of ${repo}'s dependency graph.`,
        `Do NOT attribute dependents or risk from the evidence bundle to out-of-scope @ files.`,
        `Add **Out-of-scope @ attachments** only when the synthesis prompt ## @ attachments section lists out-of-repo paths — omit that section when all @ files are in scope.`
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "knowledge-gaps": {
      const file = fileLabel(ctx);
      const target = ctx.file?.trim() ? `the primary open file (${file})` : `repository ${repo}`;
      return [
        preamble,
        budgetRule,
        `The knowledge-gaps audit target is ${target} unless user args say otherwise.`,
        `In-repo @ paths in ${repo} may be audited alongside the active scope; local workspace or foreign-repo paths are outside ${repo}.`,
        `Do NOT report ${repo} documentation or ownership gaps for out-of-scope @ files.`,
        `Add **Out-of-scope @ attachments** only when the synthesis prompt ## @ attachments section lists out-of-repo paths — omit that section when all @ files are in scope.`
      ]
        .filter(Boolean)
        .join(" ");
    }
  }
}

/** Append @-attachment scope to a slash command's custom args (or follow-up text). */
export function appendQuickActionMentionScope(
  actionId: QuickActionId,
  userText: string,
  ctx: RepoContext,
  mentions?: QuickActionMentionRef[]
): string {
  const trimmed = userText.trim();
  if (!mentions?.length) {
    return trimmed;
  }
  const guidance = mentionModelGuidance(actionId, mentions, ctx);
  return trimmed ? `${trimmed}\n${guidance}` : guidance;
}

export function quickActionPromptParts(
  actionId: QuickActionId,
  ctx: RepoContext,
  mentions: QuickActionMentionRef[] = []
): QuickActionPromptParts {
  const repo = repoLabel(ctx);
  const branch = branchLabel(ctx);
  const file = fileLabel(ctx);
  const host = providerNote(ctx);
  const source = fileSourceNote(ctx);

  switch (actionId) {
    case "understand-repo": {
      const repoWide = !ctx.file?.trim();
      const chips: QuickActionContextChip[] = [
        { key: "repo", value: repo },
        { key: "branch", value: branch }
      ];
      if (ctx.file) {
        chips.push({ key: "active file", value: ctx.file });
      }
      return {
        display: "Understand this repository's architecture, subsystems, and risks.",
        model: [
          "Explain this repository for a new engineer joining the team.",
          DIRECTIVE,
          repoWide
            ? `Context: repo ${repo}, branch ${branch}${host}.`
            : `Context: repo ${repo}, branch ${branch}${host}, active file ${file}${ctx.languageId ? `, language ${ctx.languageId}` : ""}.`,
          "Use attached repo entry files, graph context, and manifest metadata from the evidence bundle.",
          mentions.length
            ? mentionModelGuidance("understand-repo", mentions, ctx)
            : "Cover architecture repo-wide — not a deep dive on only the active file unless it illustrates a cross-cutting pattern.",
          repoWide ? REPO_WIDE_CROSS_ACTION_HINT : ""
        ]
          .filter(Boolean)
          .join("\n"),
        chips: mentionChip(mentions) ? [...chips, mentionChip(mentions)!] : chips
      };
    }
    case "trace-decision": {
      const lineHint = ctx.selectedLines ? `${ctx.selectedLines[0]}-${ctx.selectedLines[1]}` : "none";
      const chips: QuickActionContextChip[] = [{ key: "file", value: file }];
      if (ctx.selectedLines) {
        chips.push({ key: "lines", value: lineHint });
      }
      if (repo !== "unknown") {
        chips.push({ key: "repo", value: repo }, { key: "branch", value: branch });
      }
      return {
        display: "Trace the engineering decision behind this code.",
        model: [
          "Explain why this code exists and what trade-offs were accepted.",
          DIRECTIVE,
          `Context: file ${file}, lines ${lineHint}, repo ${repo}, branch ${branch}${host}${source}.`,
          "Use attached decision timeline, blame, PR, Slack, Teams, and Jira evidence from the evidence bundle — cite sources explicitly.",
          ...(mentions.length ? [mentionModelGuidance("trace-decision", mentions, ctx)] : []),
          "State confidence when evidence is thin; do not invent ticket IDs, PR numbers, or URLs."
        ].join("\n"),
        chips: mentionChip(mentions) ? [...chips, mentionChip(mentions)!] : chips
      };
    }
    case "find-owner": {
      const repoWide = !ctx.file?.trim();
      const chips: QuickActionContextChip[] = repoWide
        ? [
            { key: "repo", value: repo },
            { key: "branch", value: branch }
          ]
        : [
            { key: "file", value: file },
            { key: "repo", value: repo }
          ];
      return {
        display: repoWide
          ? "Map repository ownership and who to contact."
          : "Find who owns this area and how to reach them.",
        model: [
          repoWide
            ? "Map repository-wide ownership: top experts, CODEOWNERS coverage, team structure, and escalation paths."
            : "Identify true owners for this path and who to contact first.",
          DIRECTIVE,
          repoWide
            ? `Context: repo ${repo}, branch ${branch}${host}.`
            : `Context: file ${file}, repo ${repo}, branch ${branch}${host}${source}.`,
          "Use ownership scores, commit/review history, Slack presence, and org identity links from the evidence bundle.",
          ...(mentions.length ? [mentionModelGuidance("find-owner", mentions, ctx)] : []),
          repoWide
            ? "Highlight single points of failure, cross-team boundaries, and who to ask first for unfamiliar areas — not a single-file deep dive."
            : "Include confidence, escalation path, and fallback contacts when primary experts are unavailable or offline.",
          repoWide ? FIND_OWNER_REPO_WIDE_CROSS_ACTION_HINT : ""
        ]
          .filter(Boolean)
          .join("\n"),
        chips: mentionChip(mentions) ? [...chips, mentionChip(mentions)!] : chips
      };
    }
    case "blast-radius": {
      const chips: QuickActionContextChip[] = [
        { key: "file", value: file },
        { key: "repo", value: repo },
        { key: "branch", value: branch }
      ];
      if (ctx.languageId) {
        chips.push({ key: "language", value: ctx.languageId });
      }
      return {
        display: "Estimate the impact of changing this code.",
        model: [
          "Analyze what breaks if this area is modified.",
          DIRECTIVE,
          `Context: file ${file}, repo ${repo}, branch ${branch}${host}${ctx.languageId ? `, language ${ctx.languageId}` : ""}${source}.`,
          "Use dependency graph data, evidence bundle context, and open-file content when present.",
          ...(mentions.length ? [mentionModelGuidance("blast-radius", mentions, ctx)] : []),
          "Prioritize the top 5 ranked risk surfaces from dependency evidence — summarize APIs, integrations, operational risk, and testing surfaces; do not enumerate every dependent path."
        ].join("\n"),
        chips: mentionChip(mentions) ? [...chips, mentionChip(mentions)!] : chips
      };
    }
    case "knowledge-gaps": {
      const repoWide = !ctx.file?.trim();
      const chips: QuickActionContextChip[] = repoWide
        ? [
            { key: "repo", value: repo },
            { key: "branch", value: branch }
          ]
        : [
            { key: "file", value: file },
            { key: "branch", value: branch },
            ...(repo !== "unknown" ? [{ key: "repo", value: repo }] : [])
          ];
      return {
        display: repoWide
          ? "Audit documentation and ownership gaps across this repository."
          : "Audit documentation and ownership gaps for this area.",
        model: [
          repoWide
            ? "Audit documentation, ownership, and operational unknowns across this repository."
            : "Audit documentation, ownership, and operational unknowns for this file or area.",
          DIRECTIVE,
          repoWide
            ? `Context: repo ${repo}, branch ${branch}${host}.`
            : `Context: file ${file}, branch ${branch}, repo ${repo}${host}${source}.`,
          "Use attached knowledge_gap_scan findings, Confluence/Notion/Google Docs search results, and code context from the evidence bundle.",
          ...(mentions.length ? [mentionModelGuidance("knowledge-gaps", mentions, ctx)] : []),
          repoWide
            ? "Prioritize repo-wide blind spots — missing docs, unclear ownership, and orphaned areas — not a single-file deep dive unless evidence points there."
            : "List concrete open questions and what evidence would resolve each — omit sections with no findings."
        ].join("\n"),
        chips: mentionChip(mentions) ? [...chips, mentionChip(mentions)!] : chips
      };
    }
  }
}

/** Compact bubble body: intent line + context chips (no format instructions). */
export function formatQuickActionHistoryContent(
  actionId: QuickActionId,
  ctx: RepoContext,
  mentions: QuickActionMentionRef[] = []
): string {
  const { display, chips } = quickActionPromptParts(actionId, ctx, mentions);
  if (chips.length === 0) {
    return display;
  }
  const chipLine = chips.map((chip) => `${chip.key}: ${chip.value}`).join(" · ");
  return `${display}\n${chipLine}`;
}

export function quickActionDisplayText(
  actionId: QuickActionId,
  ctx: RepoContext,
  mentions: QuickActionMentionRef[] = []
): string {
  return formatQuickActionHistoryContent(actionId, ctx, mentions);
}

/** Chat bubble/history text for quick actions — shared by grid buttons and action slash commands. */
export function quickActionHistoryContent(
  actionId: QuickActionId,
  ctx: RepoContext,
  userArgs?: string,
  mentions: QuickActionMentionRef[] = []
): string {
  const args = userArgs?.trim();
  if (args) {
    const attached = mentionChip(mentions);
    const body = attached ? `${args}\n${attached.key}: ${attached.value}` : args;
    return `[${actionId}] ${body}`;
  }
  return `[${actionId}] ${quickActionDisplayText(actionId, ctx, mentions)}`;
}

export function quickActionModelPrompt(
  actionId: QuickActionId,
  ctx: RepoContext,
  mentions: QuickActionMentionRef[] = []
): string {
  return quickActionPromptParts(actionId, ctx, mentions).model;
}

/** Model user turn — prefer quickActionModelPrompt for new call sites. */
export function quickActionPrompt(actionId: QuickActionId, ctx: RepoContext): string {
  return quickActionModelPrompt(actionId, ctx);
}
