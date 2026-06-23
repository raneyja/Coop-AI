import { repoSummaryFromBundle } from "../context/contextBundleEvidence";
import type { IntegrationChatProvider } from "../chat/types";
import {
  mentionAttachmentLabel,
  mentionsHaveOutOfScopeForActiveRepo,
  partitionMentionsForQuickAction,
  type MentionScopeQuickAction,
  type MentionScopeRef
} from "./mentionScope";

const OUT_OF_SCOPE_HEADING = "**Out-of-scope @ attachments**";

const ALTERNATE_ACTION: Partial<Record<MentionScopeQuickAction, string>> = {
  "trace-decision": "Trace Decision",
  "find-owner": "Find Owner",
  "understand-repo": "Understand Repo",
  "blast-radius": "Blast Radius",
  "knowledge-gaps": "Knowledge Gaps",
  integration: "the relevant quick action or integration search"
};

export function resolveOutOfScopeMentionLabels(
  action: MentionScopeQuickAction | undefined,
  mentions: MentionScopeRef[],
  options: {
    activeRepoId?: string;
    owner?: string;
    repo?: string;
    contextBundle?: unknown;
  }
): string[] {
  if (!mentions.length) {
    return [];
  }

  const scopeAction: MentionScopeQuickAction | undefined =
    action ??
    (mentionsHaveOutOfScopeForActiveRepo(mentions, options.activeRepoId) ? "integration" : undefined);
  if (!scopeAction) {
    return [];
  }

  const summary =
    scopeAction === "understand-repo"
      ? repoSummaryFromBundle(Array.isArray(options.contextBundle) ? options.contextBundle : [])
      : undefined;

  const scope = partitionMentionsForQuickAction(scopeAction, mentions, {
    activeRepoId: options.activeRepoId,
    owner: options.owner,
    repo: options.repo,
    repoSummary: summary
  });

  return scope.outOfRepo.map((mention) => mentionAttachmentLabel(mention));
}

function insertBeforeSection(content: string, sectionHeading: string, block: string): string | undefined {
  const pattern = new RegExp(`\\n${escapeRegExp(sectionHeading)}\\s*\\n`, "i");
  const match = pattern.exec(content);
  if (match?.index !== undefined) {
    return `${content.slice(0, match.index)}\n\n${block}${content.slice(match.index)}`;
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inject Out-of-scope @ attachments when the model omitted it but synthesis listed foreign paths. */
export function enrichOutOfScopeMentionsInResponse(
  content: string,
  options: {
    action?: MentionScopeQuickAction;
    outOfScopePaths: string[];
    targetLabel: string;
  }
): string {
  if (!options.outOfScopePaths.length) {
    return content;
  }
  if (content.includes(OUT_OF_SCOPE_HEADING)) {
    return content;
  }

  const alternateAction = (options.action && ALTERNATE_ACTION[options.action]) ?? "the matching quick action";
  const bullets = options.outOfScopePaths.map(
    (path) =>
      `- \`${path}\` — outside ${options.targetLabel}; not used in this analysis. Open a file from that project and run **${alternateAction}** for a dedicated result.`
  );
  const block = [OUT_OF_SCOPE_HEADING, ...bullets].join("\n");

  return (
    insertBeforeSection(content, "**Sources**", block) ??
    insertBeforeSection(content, "**Gaps**", block) ??
    insertBeforeSection(content, "**Recommended next step**", block) ??
    `${content.trimEnd()}\n\n${block}`
  );
}

/** Direct reply when the user @-attached only out-of-repo files and asked about "this file". */
export function buildOutOfScopeMentionOnlyResponse(options: {
  outOfScopePaths: string[];
  targetLabel: string;
}): string {
  if (!options.outOfScopePaths.length) {
    return "";
  }
  const bullets = options.outOfScopePaths.map(
    (path) =>
      `- \`${path}\` — outside **${options.targetLabel}**; not used in this analysis.`
  );
  return [
    "The @-attached file is outside the active repository, so I can't analyze it in this context.",
    "",
    "**Out-of-scope @ attachments**",
    ...bullets,
    "",
    "Open a file from that project (or its repo folder) and ask again, or @ a file from the active repo."
  ].join("\n");
}
