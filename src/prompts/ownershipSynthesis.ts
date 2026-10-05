import type { SlackSearchEvidence } from "../context/contextBundleEvidence";
import { REPO_OWNERSHIP_PATH } from "../context/quickActionScope";
import type { OwnershipReport } from "../types/ownership";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendUserFocusInstructions,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  ATTACHED_FACTS_HEADING,
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
1. Identifies evidenced authors, reviewers and declared owners for the target path or repository
2. Describes retrieved contributor counts and identifies what ownership coverage remains unverified
3. Includes an evidenced CODEOWNERS contact or recent reviewer as a contact candidate — otherwise state that declared ownership and escalation policy are unverified in this pass, and recommend checking repository admins/maintainers. Missing CODEOWNERS/team matches do not prove that no declared owner exists. Never end on "no backup" / "no strong secondary" with zero escalation guidance.
4. Identifies expertise coverage gaps — recommend pairing, a secondary owner, or escalation before any staffing change
5. Recommends knowledge transfer targets (who should learn this)

Be pragmatic: if someone is listed as owner but inactive, say who to actually ask.
Distinguish code authors from reviewers. Use plain language in narrative sections; reserve \`[Sources: …]\` labels for **Sources** (at most 1-2 inline in **Summary**).
Commit concentration shows activity in the sampled history; it does not prove sole knowledge, maintainership, or an on-call policy. State missing ownership or escalation evidence plainly. Label any suggested contact as a recommendation, not a verified escalation policy. Merge identity aliases only when attached account identifiers or verified identity evidence connects them.
An author or reviewer is a contact candidate, not a declared owner. Only explicit attached CODEOWNERS/team ownership evidence supports a declared-owner claim. Compare activity dates with the attached analysis time: a commit today is recent, never inactive or "no commits last quarter". Missing dates and conflicting aggregates mean recency is unknown; do not invent an activity window. Slack away/offline indicates presence only, not repository inactivity or lack of ownership.
Slack active is an observed presence state, not proof someone is reachable, available to respond, or on call. Preserve inferred identity qualifiers; inferred name matches are not verified person links. Without attached presence, contact availability is unknown regardless of recent commits or teamGraph.available.
No scored secondary means no secondary was identified in the sampled evidence; never say no secondary owner exists. A contribution-concentration flag is a coverage question, not proof the repository is a single point of failure. Derived teamGraph escalation text is a suggested fallback, never a verified escalation policy or proof that admins are the only available contacts.
Commit counts and their time buckets describe the retrieved sample, not complete repository history. A single seed commit cannot prove no commits in earlier quarters/years, absence of ongoing maintenance, or confirmed personnel/knowledge risk. Only independently established complete coverage supports an absence claim; otherwise say the earlier history or maintenance pattern is unverified.
Never invent people or Slack handles — every named human or team must appear in the attached sources (commits, reviews, CODEOWNERS) with a source label.
Never attribute ownership from the target repository to @-attached files from other repositories or workspaces.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type OwnershipSynthesisInput = {
  report: OwnershipReport;
  file: string;
  slackSearch?: SlackSearchEvidence;
  userQuestion?: string;
  /** Specific ask after a slash command / custom prompt — answer in the opening prose. */
  userFocus?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
  /** Injectable clock for reproducible activity interpretation. */
  now?: Date;
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
  appendUserFocusInstructions(lines, input.userFocus);
  lines.push("## Target path");
  lines.push(`- Repository: ${report.owner}/${report.repo}`);
  lines.push(`- Path: ${repoWide ? "repository-wide" : report.path}`);
  lines.push(`- Analysis completeness: ${report.completeness}`);
  appendMentionScopeSection(lines, input);
  lines.push("");
  lines.push(ATTACHED_FACTS_HEADING);
  lines.push(formatOwnershipReportForPrompt(report, input.slackSearch, input.now));
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
      "Describe repository-wide ownership evidence from attached sources — sampled contributors, declared CODEOWNERS coverage, evidenced team boundaries, and suggested contacts."
    );
    lines.push(
      "When CODEOWNERS data is present, lead with the owning team, then escalation order (primary → secondary → manager or Slack channel)."
    );
  } else {
    lines.push("Synthesize from evidence only.");
  }
  lines.push(
    "Required on-call shape: name an evidenced contact candidate with a source label, then give a declared CODEOWNERS contact or a recommended avenue from derived teamGraph / recent reviewers. Label missing policy evidence and admin fallback as recommendations. Do not invent contacts or claim a fallback is the only verified route."
  );
  lines.push(
    "Missing or unmatched CODEOWNERS/team evidence means declared ownership is unverified in this pass, not absent. Do not conclude that there is no declared owner from an empty match, missing orgContext, report completeness, or contributor scores. An absence claim requires independently attached policy coverage proving it; otherwise verify the current ownership policy before recommending an ownership change."
  );
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
    `- Cite \`${ownershipSourceLabelSlack()}\` only for the observed presence state and its linked/inferred identity qualifier, never guaranteed reachability or response availability; do not cite \`${ownershipSourceLabelSlackDiscussions()}\` when no discussion messages were returned.`
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
    excludeFromLabel: "Contributor / ownership analysis",
    alternateActionLabel: "Find Owner"
  });
}

export function formatOwnershipReportForPrompt(
  report: OwnershipReport,
  slackSearch?: SlackSearchEvidence,
  now = new Date()
): string {
  const sections: string[] = [];

  if (report.orgContext?.source === "codeowners" || report.orgContext?.source === "github_teams") {
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

  sections.push("### Ownership policy coverage\n- A missing CODEOWNERS/team match does not prove no declared owner exists. Unless independently attached policy coverage establishes absence, declared ownership is unverified in this pass. Report completeness and contributor scores do not establish exhaustive policy coverage.");
  sections.push(`### Activity interpretation\n- Analysis time (UTC): ${now.toISOString()}\n- Score tiers rank sampled contributors; they do not declare ownership. Missing or contradictory recency evidence is unknown. Slack presence is not repository activity.\n- Retrieved counts are sampled evidence, not complete history. Do not infer empty earlier quarters/years, absent ongoing maintenance, or confirmed knowledge risk from a seed commit or missing secondary.`);

  if (report.scores.length > 0) {
    sections.push(
      `### ${ownershipSourceLabelGitHub()}\n` +
        report.scores
          .slice(0, 10)
          .map(
            (s) =>
              `- @${s.owner} (sampled ${ownershipTierLabel(s.tier)} contributor)` +
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

  const activityDates = [
    report.pathEvolution?.lastModifiedAt,
    ...(report.signals?.commits.map((s) => s.lastCommitDate) ?? []),
    ...(report.signals?.reviews.map((s) => s.lastReviewDate) ?? []),
    ...(report.signals?.activity.map((s) => s.lastActiveDate) ?? [])
  ].filter((date): date is string => Boolean(date));
  const recentActivity = activityDates.some((date) => {
    const stamp = Date.parse(date);
    return Number.isFinite(stamp) && stamp <= now.getTime() && stamp >= now.getTime() - 90 * 86400000;
  });
  if (report.signals?.commits.length) {
    sections.push("### Dated sampled contributors\n" + report.signals.commits.slice(0, 10)
      .map((s) => `- ${s.authorLogin ? `@${s.authorLogin}` : s.author}: last commit ${s.lastCommitDate ?? "unknown"}; sampled counts 6mo=${s.counts.sixMonths}, 1yr=${s.counts.oneYear}, all=${s.counts.allTime}`)
      .join("\n"));
  }
  const conflictingRisk = recentActivity && (report.risk.expertUnavailable || report.risk.orphaned);
  // Risk booleans are derived from a bounded sample. Do not present their
  // personnel/coverage interpretations as attached facts for synthesis.
  const primaryCount = report.scores.filter((score) => score.tier === "primary").length;
  const secondaryCount = report.scores.filter((score) => score.tier === "secondary").length;
  sections.push(
    `### Retrieved contributor sample\n- Scored primary contributors: ${primaryCount}\n- Scored secondary contributors: ${secondaryCount}\n- Total scored contributors: ${report.scores.length}\n- Broader maintainer, backup and knowledge coverage: unavailable from these counts.`
  );
  if (conflictingRisk) {
    sections.push("### Recency conflict\n- Recent dated activity conflicts with inactivity/stale aggregate flags. Do not claim no recent commits or inactive ownership; aggregate recency is unknown. Availability and declared ownership remain separate questions.");
  }

  sections.push(`### Derived contact recommendations\n- Suggested escalation (not a verified policy): ${report.teamGraph.escalationPath}\n- Missing a scored secondary does not establish that no secondary owner exists. Repository admins are a suggested fallback; their identities and escalation policy require separate evidence.`);
  // crossTeamNote is derived prose, not independently evidenced team policy.
  if (report.teamGraph.members.length) {
    sections.push(
      report.teamGraph.members
        .map((m) => `- @${m.owner} (sampled ${m.role} contributor; response availability unverified)`)
        .join("\n")
    );
  }

  if (report.orgContext && report.orgContext.source !== "codeowners" && report.orgContext.source !== "github_teams") {
    sections.push(
      `### Organizational context\n- Team: ${report.orgContext.teamName} (${report.orgContext.source})\n- Members: ${report.orgContext.members.join(", ") || "unknown"}`
    );
  }

  if (report.history.length) {
    sections.push(
      "### Sampled contributor ranking by period (not declared ownership)\n" +
        report.history.map((h) => `- ${h.label}: highest-ranked contributor ${h.primaryOwner || "unknown"}; other ranked contributors ${h.secondaryOwners.join(", ") || "none retrieved"}`).join("\n")
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
