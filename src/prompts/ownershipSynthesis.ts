import type { SlackSearchEvidence } from "../context/contextBundleEvidence";
import { REPO_OWNERSHIP_PATH } from "../context/quickActionScope";
import type { OwnershipReport } from "../types/ownership";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForOwnership,
  type MentionScopeRef
} from "./mentionScope";
import {
  listOwnershipSourceLabels,
  listOwnershipSourcesChecklist,
  ownershipSourceLabelCodeowners,
  ownershipSourceLabelGitHub,
  ownershipSourceLabelSlack,
  ownershipSourceLabelSlackDiscussions,
  ownershipTierLabel
} from "./ownershipSourceLabels";

export const OWNERSHIP_INTELLIGENCE_SYSTEM = `You are an organizational intelligence system. Given structured evidence from the Sources card:
- Code ownership patterns (commit history, reviews, issue resolution)
- Current team structure
- Slack availability status
- Expertise specialties

Synthesize a response that:
1. Identifies the true expert(s) for the target path or repository
2. Highlights any single-point-of-failure risks
3. Suggests backup experts or escalation paths
4. Identifies expertise coverage gaps — recommend pairing, a secondary owner, or escalation before any staffing change
5. Recommends knowledge transfer targets (who should learn this)

Be pragmatic: if someone is listed as owner but inactive, say who to actually ask.
Distinguish code authors from reviewers. Use plain language in narrative sections; reserve \`[Sources: …]\` labels for **Sources** (at most 1-2 inline in **Summary**).
Never attribute ownership from the target repository to @-attached files from other repositories or workspaces.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type OwnershipSynthesisInput = {
  report: OwnershipReport;
  file: string;
  slackSearch?: SlackSearchEvidence;
  userQuestion?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildOwnershipSynthesisUserPrompt(input: OwnershipSynthesisInput): string {
  const { report, file, userQuestion } = input;
  const repoWide = !file?.trim() || file === REPO_OWNERSHIP_PATH || report.path === REPO_OWNERSHIP_PATH;
  const targetLabel = repoWide
    ? `${report.owner}/${report.repo}`
    : file || report.path;
  const lines: string[] = [];

  lines.push("## Task");
  lines.push(
    userQuestion?.trim() ||
      (repoWide
        ? `Who owns ${report.owner}/${report.repo} and who should I contact for questions or changes?`
        : `Who truly owns ${targetLabel} and who should I contact for questions or changes?`)
  );
  lines.push("");
  lines.push("## Target path");
  lines.push(`- Repository: ${report.owner}/${report.repo}`);
  lines.push(`- Path: ${repoWide ? "repository-wide" : report.path}`);
  lines.push(`- Analysis completeness: ${report.completeness}`);
  appendMentionScopeSection(lines, input);
  lines.push("");
  lines.push("## Evidence bundle");
  lines.push(formatOwnershipReportForPrompt(report, input.slackSearch));
  lines.push("");
  const citationKeys = listOwnershipSourceLabels(report, input.slackSearch);
  const sourcesChecklist = listOwnershipSourcesChecklist(report, input.slackSearch);
  appendCitationKeysSection(lines, citationKeys);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendSupplementarySourceCitationGuardrails(lines, sourcesChecklist, [
    ownershipSourceLabelSlackDiscussions(),
    ...supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  ]);
  appendEvidenceQualityInstructions(lines);
  appendOwnershipSlackCitationGuidance(lines, report, input.slackSearch);
  appendEvidenceEnrichmentInstructions(lines, Boolean(report.pathEvolution));
  appendPathEvolutionGuidance(lines, report.pathEvolution);
  if (repoWide) {
    lines.push(
      "Synthesize repository-wide ownership from the evidence bundle — top experts, CODEOWNERS coverage, team boundaries, and escalation paths."
    );
    lines.push(
      "When CODEOWNERS data is present, lead with the owning team, then escalation order (primary → secondary → manager or Slack channel)."
    );
  } else {
    lines.push("Synthesize from evidence only.");
  }
  lines.push("Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

function appendOwnershipSlackCitationGuidance(
  lines: string[],
  report: OwnershipReport,
  slackSearch?: SlackSearchEvidence
): void {
  const hasPresence = report.scores.some((score) => score.presence);
  const hasDiscussions = (slackSearch?.messages?.length ?? 0) > 0;
  if (!hasPresence || hasDiscussions) {
    return;
  }
  lines.push("## Slack citation guidance");
  lines.push(
    `- Cite \`${ownershipSourceLabelSlack()}\` for owner availability/active status — do not cite \`${ownershipSourceLabelSlackDiscussions()}\` when no discussion messages were returned.`
  );
  lines.push("");
}

function appendMentionScopeSection(lines: string[], input: OwnershipSynthesisInput): void {
  if (!input.mentionedFiles?.length) {
    return;
  }

  const scope = partitionMentionsForOwnership(
    input.mentionedFiles,
    input.report,
    input.activeRepoId
  );
  appendMentionScopePromptSection(lines, {
    targetLabel: `${input.report.owner}/${input.report.repo}`,
    scope,
    inScopeInstruction: "include ownership for these paths",
    excludeFromLabel: "True experts / ownership analysis",
    alternateActionLabel: "Find Owner"
  });
}

export function formatOwnershipReportForPrompt(
  report: OwnershipReport,
  slackSearch?: SlackSearchEvidence
): string {
  const sections: string[] = [];

  if (report.orgContext?.source === "codeowners") {
    const ctx = report.orgContext;
    sections.push(
      `### ${ownershipSourceLabelCodeowners()}\n` +
        `- Team: ${ctx.teamName}${ctx.teamSlug ? ` (@${ctx.teamSlug})` : ""}\n` +
        `- Members: ${ctx.members.join(", ") || "unknown"}` +
        (ctx.manager ? `\n- Manager: ${ctx.manager}` : "") +
        (ctx.slackChannel ? `\n- Slack channel: ${ctx.slackChannel}` : "") +
        (ctx.htmlUrl ? `\n- Team URL: ${ctx.htmlUrl}` : "")
    );
  }

  if (report.scores.length > 0) {
    sections.push(
      `### ${ownershipSourceLabelGitHub()}\n` +
        report.scores
          .slice(0, 10)
          .map(
            (s) =>
              `- @${s.owner} (${ownershipTierLabel(s.tier)})` +
              `${s.specialty ? ` · specialty: ${s.specialty}` : ""}` +
              `${s.commitCount ? ` · ${s.commitCount} commits (6mo)` : ""}` +
              `${s.reviewApprovals ? ` · ${s.reviewApprovals} PR approvals` : ""}` +
              `${s.presence ? ` · Slack: ${s.presence.label}` : ""}`
          )
          .join("\n") +
        truncationNote(report.scores.length, 10)
    );
  } else {
    sections.push("### Ownership scores\nNo scored owners identified.");
  }

  const presenceScores = report.scores.filter((score) => score.presence);
  if (presenceScores.length > 0 && !slackSearch?.messages?.length) {
    sections.push(
      `### ${ownershipSourceLabelSlack()}\n` +
        presenceScores
          .slice(0, 10)
          .map((score) => `- @${score.owner}: ${score.presence!.label}`)
          .join("\n") +
        truncationNote(presenceScores.length, 10)
    );
  }

  const riskFlags = Object.entries(report.risk)
    .filter(([, value]) => value)
    .map(([key]) => key);
  sections.push(
    "### Risk flags\n" + (riskFlags.length ? riskFlags.map((f) => `- ${humanizeRiskFlag(f)}`).join("\n") : "- None flagged")
  );

  sections.push(`### Team graph\n- Escalation: ${report.teamGraph.escalationPath}`);
  if (report.teamGraph.crossTeamNote) {
    sections.push(`- Cross-team: ${report.teamGraph.crossTeamNote}`);
  }
  if (report.teamGraph.members.length) {
    sections.push(
      report.teamGraph.members
        .map((m) => `- @${m.owner} (${m.role}, ${m.available ? "available" : "inactive"})`)
        .join("\n")
    );
  }

  if (report.orgContext && report.orgContext.source !== "codeowners") {
    sections.push(
      `### Organizational context\n- Team: ${report.orgContext.teamName} (${report.orgContext.source})\n- Members: ${report.orgContext.members.join(", ") || "unknown"}`
    );
  }

  if (report.history.length) {
    sections.push(
      "### Ownership evolution\n" +
        report.history.map((h) => `- ${h.label}: ${h.narrative}`).join("\n")
    );
  }

  if (report.pathEvolution) {
    const evolution = report.pathEvolution;
    sections.push(
      "### Path evolution\n" +
        `- Recent commits analyzed: ${evolution.recentCommitCount}` +
        (evolution.lastModifiedAt ? `\n- Last modified: ${evolution.lastModifiedAt}` : "") +
        (evolution.lastModifiedAuthor ? `\n- Last modifier: ${evolution.lastModifiedAuthor}` : "")
    );
  }

  if (slackSearch?.messages?.length) {
    sections.push(
      `### ${ownershipSourceLabelSlackDiscussions()}\n` +
        slackSearch.messages
          .slice(0, 10)
          .map((message) => `- ${message.channelName ? `#${message.channelName}` : "Slack"} · ${message.userName ?? "unknown"}: ${message.text.slice(0, 160)}`)
          .join("\n") +
        truncationNote(slackSearch.messages.length, 10)
    );
  }

  if (report.warnings.length) {
    sections.push("### Warnings\n" + report.warnings.map((w) => `- ${w}`).join("\n"));
  }

  return sections.join("\n\n");
}

function appendPathEvolutionGuidance(
  lines: string[],
  pathEvolution: OwnershipReport["pathEvolution"]
): void {
  if (!pathEvolution) {
    return;
  }
  lines.push("## Path evolution guidance");
  lines.push(
    `- Bundle includes pathEvolution: ${pathEvolution.recentCommitCount} recent commit(s)` +
      (pathEvolution.lastModifiedAuthor ? `; last touched by ${pathEvolution.lastModifiedAuthor}` : "") +
      (pathEvolution.lastModifiedAt ? ` on ${pathEvolution.lastModifiedAt}` : "") +
      "."
  );
  lines.push("- Mention this activity in **Summary** when recommending who to contact today.");
  lines.push("");
}

function humanizeRiskFlag(flag: string): string {
  switch (flag) {
    case "singlePointOfFailure":
      return "Single point of failure — only one person knows this area";
    case "expertUnavailable":
      return "All experts appear unavailable (inactive 3+ months)";
    case "orphaned":
      return "Orphaned — no commits in 6+ months";
    case "highTurnover":
      return "High turnover — many authors, no clear expert";
    case "teamDispersion":
      return "Team dispersion — expertise scattered";
    default:
      return flag;
  }
}
