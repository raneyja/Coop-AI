import type { OwnershipReport } from "../types/ownership";
import type { SlackSearchEvidence } from "./contextBundleEvidence";
import type { ReviewedSourceWindow } from "../prompts/sourceCitationIntegrity";
import type { SourceClaimFact } from "../chat/sourceClaimReview";
import { traceDecisionCurrentWindows } from "./traceDecisionClaimEvidence";

/** The same turn-owned remote attachment admission applies to both actions. */
export const ownershipCurrentWindows = traceDecisionCurrentWindows;

const count = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const handles = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => Boolean(text(item))) : [];
const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Admit exact typed ownership fields, never formatted evidenceSummary, ranked
 * history prose, outreach drafts, risk narratives or derived escalation text.
 * Caller owns remote repository/ref isolation; the report does not independently
 * prove branch coverage, complete history, policy absence or response availability. */
export function snapshotOwnershipClaimEvidence(
  report: OwnershipReport | undefined,
  windows: ReviewedSourceWindow[],
  identity: { owner?: string; repo?: string; branch?: string; file?: string },
  slackSearch?: SlackSearchEvidence
): { windows: ReviewedSourceWindow[]; facts: SourceClaimFact[] } {
  if (!identity.owner?.trim() || !identity.repo?.trim() || !identity.branch?.trim()) {
    throw new Error("Source review requires a selected repository and branch.");
  }
  const currentWindows = windows.map(window => ({ ...window }));
  if (!report || report.owner !== identity.owner || report.repo !== identity.repo
    || (identity.file && report.path !== identity.file)) return { windows: currentWindows, facts: [] };
  const scope = `${identity.owner}/${identity.repo}@${identity.branch}:${report.path}`;
  const facts: SourceClaimFact[] = [];
  const add = (kind: SourceClaimFact["kind"], boundary: string, value: unknown) => {
    facts.push({ kind, scope: `${scope}: ${boundary}`, value: copy(value) });
  };
  add("provenance", "Selected target and report status only. Completeness is retrieval status, not exhaustive ownership policy, activity or history coverage. Report does not independently record branch coverage.",
    { source: "ownership-target", owner: report.owner, repo: report.repo, path: report.path,
      provider: report.provider, completeness: report.completeness });
  add("sample", "Only whether this report returned a declared policy match. A missing or unmatched policy means unverified in this pass, never that no declared owner exists or that listed contributors are not declared owners elsewhere.",
    { source: "ownership-policy-coverage", declaredPolicyMatchReturned: report.orgContext?.source === "codeowners", policyCoverage: "partial-or-unverified" });
  for (const contributor of report.scores ?? []) {
    if (!text(contributor.owner)) continue;
    add("sample", "Derived ranking of retrieved contributors only. Score/tier and specialty label do not establish maintainership, declared ownership, duties, expertise, required reviewers or knowledge exclusivity. Commit count is sampled commits in six months, not all activity. Approval and issue counts are retrieved samples.",
      { source: "scored-contributor", account: contributor.owner, linkedCodeHostAccount: text(contributor.githubLogin),
        score: contributor.score, tier: contributor.tier, contributionRole: contributor.role,
        sampledCommitsSixMonths: count(contributor.commitCount), sampledReviewApprovals: count(contributor.reviewApprovals),
        sampledIssueResolutions: count(contributor.issueResolutions), derivedSpecialtyLabel: text(contributor.specialty) });
    if (contributor.presence) add("provenance", "Exact attached Slack presence state and identity qualifier only. Active/away/unknown or missing linkage cannot establish response availability, on-call responsibility, repository activity, or a verified identity when its label says inferred.",
      { source: "slack-presence", account: contributor.owner, state: contributor.presence.state,
        label: contributor.presence.label, slackUserId: contributor.presence.slackUserId,
        timezone: contributor.presence.timezone, reportedLastActive: contributor.presence.lastActive });
  }
  for (const contributor of report.signals?.commits ?? []) add("sample",
    "Retrieved commit sample only. Undated messages are traversal-order samples and have no relationship to lastSampledCommitDate. Only latestSampledCommit binds one exact SHA/date/message tuple, latest by parsed date within this retrieved sample; sameTimeCount greater than one means a tie, not a unique latest commit. No repository-wide latest activity, ongoing maintenance or exhaustive history is established. Zero counts mean no commits retrieved in that sample/window. Account aliases require an attached identity link.",
    { source: "commit-sample", author: contributor.author, account: contributor.authorLogin,
      lastSampledCommitDate: contributor.lastCommitDate,
      latestSampledCommit: contributor.latestSampledCommit,
      sampledCommits: { sixMonths: count(contributor.counts.sixMonths), oneYear: count(contributor.counts.oneYear), allRetrieved: count(contributor.counts.allTime) },
      messages: handles(contributor.messages) });
  for (const reviewer of report.signals?.reviews ?? []) add("sample",
    "Retrieved review activity and participant identity only; not declared ownership, required reviewer, present response availability or comprehensive activity coverage.",
    { source: "review-sample", account: reviewer.author, sampledApprovals: count(reviewer.approvals),
      sampledReviews: count(reviewer.reviews), lastSampledReviewDate: reviewer.lastReviewDate, reviewerOnly: reviewer.isReviewerOnly });
  for (const issue of report.signals?.issues ?? []) add("sample",
    "Retrieved issue activity only. Assignment/resolution does not establish current code ownership, duties, exhaustive activity or availability.",
    { source: "issue-sample", account: issue.author, sampledAssigned: count(issue.assigned),
      sampledResolved: count(issue.resolved), lastSampledActivityDate: issue.lastActivityDate });
  for (const activity of report.signals?.activity ?? []) add("sample",
    "Derived activity classification from retrieved contribution signals, not independent all-activity coverage or response availability. Missing/invalid dates remain unknown; inactive is a derived sample flag only.",
    { source: "derived-activity", account: activity.author, lastSampledActivityDate: activity.lastActiveDate, inactiveFlag: activity.inactive });
  const org = report.orgContext;
  if (org?.source === "codeowners") add("provenance",
    "Reported matched CODEOWNERS declaration: only declaredHandles identify the declared path owners. Team display/lookup metadata, manager/channel fields and extraLookupMembers are organizational context, not additional declared owners or a verified escalation/on-call policy.",
    { source: "matched-codeowners", declaredHandles: handles(org.members), matchedPattern: org.codeownersPattern,
      displayTeamName: org.teamName, reportedTeamHandle: org.teamSlug,
      extraLookupMembers: handles(org.teamMembers), reportedManager: org.manager,
      reportedSlackChannel: org.slackChannel, teamUrl: org.htmlUrl });
  else if (org?.source === "github_teams") add("provenance",
    "Repository-team lookup metadata only. Membership or permissions establish no declared path ownership, required reviewer, duties, on-call policy or response availability. This is not a matched CODEOWNERS rule.",
    { source: "repository-team-lookup", teamName: org.teamName, teamSlug: org.teamSlug,
      lookupMembers: handles(org.members), reportedManager: org.manager, reportedSlackChannel: org.slackChannel, teamUrl: org.htmlUrl });
  if (report.pathEvolution) add("sample",
    "Retrieved path commit activity and latest retrieved modifier/date only. The count describes the retrieved sample, not all recent commits; the modifier is a contact candidate, not a declared owner or available contact.",
    { source: "path-commit-sample", retrievedCommitCount: count(report.pathEvolution.recentCommitCount),
      lastRetrievedModifiedAt: report.pathEvolution.lastModifiedAt, lastRetrievedModifier: report.pathEvolution.lastModifiedAuthor });
  add("sample", "Mechanical coverage flags from contributor counts and sampled dates only. Their historical field names do not establish unavailable staff, orphaned code, turnover, teams, staffing risk, sole knowledge or comprehensive coverage.",
    { source: "derived-coverage-flags", singlePrimaryWithoutSecondary: report.risk.singlePointOfFailure,
      olderSampledTopContributorActivity: report.risk.expertUnavailable,
      noRecentCommitsRetrieved: report.risk.orphaned, severalAuthorsWithoutPrimaryTier: report.risk.highTurnover,
      severalActiveContributorsWithoutPrimaryTier: report.risk.teamDispersion });
  for (const [index, message] of (slackSearch?.messages ?? []).entries()) add("provenance",
    "Exact attached Slack search-result statement and attribution only; a bounded hit, not exhaustive discussion, consensus, current availability, duty or path ownership beyond an explicitly attributed statement.",
    { source: `slack-search:${index}`, channelName: message.channelName, userName: message.userName, text: message.text });
  return { windows: currentWindows, facts };
}
