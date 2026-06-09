import type { QuickActionId } from "../webview/types";
import type { RepoContext } from "../chat/types";

/**
 * Quick-action grid prompts. Slash aliases for the same actions live in slashCommands.ts;
 * response post-processing and use-case routing are shared via chatResponseEnrichment.ts.
 */

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

export function quickActionPromptParts(actionId: QuickActionId, ctx: RepoContext): QuickActionPromptParts {
  const repo = repoLabel(ctx);
  const branch = branchLabel(ctx);
  const file = fileLabel(ctx);
  const host = providerNote(ctx);
  const source = fileSourceNote(ctx);

  switch (actionId) {
    case "understand-repo": {
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
          `Context: repo ${repo}, branch ${branch}${host}, active file ${file}${ctx.languageId ? `, language ${ctx.languageId}` : ""}.`,
          "Use attached repo entry files, graph context, and manifest metadata.",
          "Cover architecture repo-wide — not a deep dive on only the active file unless it illustrates a cross-cutting pattern."
        ].join("\n"),
        chips
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
          "Use attached decision timeline, blame, PR, Slack, Teams, and Jira evidence — cite sources explicitly.",
          "State confidence when evidence is thin; do not invent ticket IDs, PR numbers, or URLs."
        ].join("\n"),
        chips
      };
    }
    case "find-owner": {
      const chips: QuickActionContextChip[] = [
        { key: "file", value: file },
        { key: "repo", value: repo }
      ];
      return {
        display: "Find who owns this area and how to reach them.",
        model: [
          "Identify true owners for this path and who to contact first.",
          DIRECTIVE,
          `Context: file ${file}, repo ${repo}, branch ${branch}${host}${source}.`,
          "Use ownership scores, commit/review history, Slack presence, and org identity links from attached evidence.",
          "Include confidence, escalation path, and fallback contacts when primary experts are unavailable or offline."
        ].join("\n"),
        chips
      };
    }
    case "blast-radius": {
      const chips: QuickActionContextChip[] = [
        { key: "file", value: file },
        { key: "repo", value: repo }
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
          "Use dependency graph data and attached local file content when present.",
          "Cover direct dependents, APIs/integrations, operational risk, and testing surfaces."
        ].join("\n"),
        chips
      };
    }
    case "knowledge-gaps": {
      const chips: QuickActionContextChip[] = [
        { key: "file", value: file },
        { key: "branch", value: branch }
      ];
      if (repo !== "unknown") {
        chips.push({ key: "repo", value: repo });
      }
      return {
        display: "Audit documentation and ownership gaps for this area.",
        model: [
          "Audit documentation, ownership, and operational unknowns for this file or area.",
          DIRECTIVE,
          `Context: file ${file}, branch ${branch}, repo ${repo}${host}${source}.`,
          "Use attached knowledge_gap_scan findings, Confluence/Notion/Google Docs search results, and code context.",
          "List concrete open questions and what evidence would resolve each — omit sections with no findings."
        ].join("\n"),
        chips
      };
    }
  }
}

/** Compact bubble body: intent line + context chips (no format instructions). */
export function formatQuickActionHistoryContent(actionId: QuickActionId, ctx: RepoContext): string {
  const { display, chips } = quickActionPromptParts(actionId, ctx);
  if (chips.length === 0) {
    return display;
  }
  const chipLine = chips.map((chip) => `${chip.key}: ${chip.value}`).join(" · ");
  return `${display}\n${chipLine}`;
}

export function quickActionDisplayText(actionId: QuickActionId, ctx: RepoContext): string {
  return formatQuickActionHistoryContent(actionId, ctx);
}

export function quickActionModelPrompt(actionId: QuickActionId, ctx: RepoContext): string {
  return quickActionPromptParts(actionId, ctx).model;
}

/** Model user turn — prefer quickActionModelPrompt for new call sites. */
export function quickActionPrompt(actionId: QuickActionId, ctx: RepoContext): string {
  return quickActionModelPrompt(actionId, ctx);
}
