import type { OwnershipReport } from "../types/ownership";

export const OWNERSHIP_INTELLIGENCE_SYSTEM = `You are an organizational intelligence system. Given:
- Code ownership patterns (commit history, reviews, issue resolution)
- Current team structure
- Slack availability status
- Expertise specialties

Synthesize a response that:
1. Identifies the true expert(s) for this code
2. Highlights any single-point-of-failure risks
3. Suggests backup experts or escalation paths
4. Identifies expertise gaps that need hiring
5. Recommends knowledge transfer targets (who should learn this)

Be pragmatic: if someone is listed as owner but inactive, say who to actually ask.
Distinguish code authors from reviewers. Cite evidence (commit counts, PR approvals, issue resolution).
Never invent people, teams, or Slack statuses not present in the evidence bundle.`;

export type OwnershipSynthesisInput = {
  report: OwnershipReport;
  file: string;
  userQuestion?: string;
};

export function buildOwnershipSynthesisUserPrompt(input: OwnershipSynthesisInput): string {
  const { report, file, userQuestion } = input;
  const lines: string[] = [];

  lines.push("## Task");
  lines.push(
    userQuestion?.trim() ||
      `Who truly owns ${file} and who should I contact for questions or changes?`
  );
  lines.push("");
  lines.push("## Target path");
  lines.push(`- Repository: ${report.owner}/${report.repo}`);
  lines.push(`- Path: ${report.path}`);
  lines.push(`- Analysis completeness: ${report.completeness}`);
  lines.push("");
  lines.push("## Evidence bundle");
  lines.push(formatOwnershipReportForPrompt(report));
  lines.push("");
  lines.push("Synthesize from evidence only. Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

export function formatOwnershipReportForPrompt(report: OwnershipReport): string {
  const sections: string[] = [];

  if (report.scores.length > 0) {
    sections.push(
      "### Ownership scores\n" +
        report.scores
          .slice(0, 10)
          .map(
            (s) =>
              `- @${s.owner}: ${s.score} pts (${s.tier})` +
              `${s.specialty ? ` · specialty: ${s.specialty}` : ""}` +
              `${s.commitCount ? ` · ${s.commitCount} commits (6mo)` : ""}` +
              `${s.reviewApprovals ? ` · ${s.reviewApprovals} PR approvals` : ""}` +
              `${s.presence ? ` · Slack: ${s.presence.label}` : ""}`
          )
          .join("\n")
    );
  } else {
    sections.push("### Ownership scores\nNo scored owners identified.");
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
        .map((m) => `- @${m.owner} (${m.role}, score ${m.score}, ${m.available ? "available" : "inactive"})`)
        .join("\n")
    );
  }

  if (report.orgContext) {
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

  if (report.messageDraft.text) {
    sections.push(`### Suggested outreach draft (not sent)\n${report.messageDraft.text}`);
  }

  if (report.warnings.length) {
    sections.push("### Warnings\n" + report.warnings.map((w) => `- ${w}`).join("\n"));
  }

  return sections.join("\n\n");
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
