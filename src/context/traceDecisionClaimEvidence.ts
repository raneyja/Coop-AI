import type { DecisionTimeline } from "../types/decisionTimeline";
import type { ReviewedSourceWindow } from "../prompts/sourceCitationIntegrity";
import { isAbsolute } from "node:path";
import { normalizeRelativePath, type LocalFileContextPayload } from "./localFileContext";
import { looksLikeAbsoluteDiskPath } from "./outsideWorkspaceFile";
import type { SourceClaimFact } from "../chat/sourceClaimReview";

/** Only the canonical, turn-owned remote attach payload may call this adapter.
 * The caller owns repo/ref isolation; this adapter admits the selected path and
 * real line coordinates, never a local/external or neighboring attachment.
 */
export function traceDecisionCurrentWindows(payload: LocalFileContextPayload | undefined, selectedFile: string | undefined): ReviewedSourceWindow[] {
  if (payload?.source !== "remote-codehost" || !selectedFile || (looksLikeAbsoluteDiskPath(selectedFile) || isAbsolute(selectedFile))) return [];
  const path = normalizeRelativePath(selectedFile);
  if (!path || path.split("/").includes("..") || looksLikeAbsoluteDiskPath(payload.activeFile) || isAbsolute(payload.activeFile) || normalizeRelativePath(payload.activeFile) !== path) return [];
  return payload.files.flatMap(file => {
    if (looksLikeAbsoluteDiskPath(file.path) || isAbsolute(file.path) || normalizeRelativePath(file.path) !== path || !file.content.trim()) return [];
    const startLine = file.lineRange?.[0] ?? 1;
    if (!Number.isInteger(startLine) || startLine < 1) return [];
    if (file.lineRange) {
      const end = file.lineRange[1];
      if (!Number.isInteger(end) || end < startLine || end - startLine + 1 !== file.content.split(/\r?\n/).length) return [];
    }
    return [{ path, content: file.content, startLine }];
  });
}

/** Exact admitted fields, never an AI overview or derived history narrative. */
export function snapshotTraceClaimEvidence(timeline: DecisionTimeline, windows: ReviewedSourceWindow[] = []): {
  windows: ReviewedSourceWindow[];
  facts: SourceClaimFact[];
} {
  const facts: SourceClaimFact[] = [];
  const add = (scope: string, value: unknown) => facts.push({
    kind: "provenance", scope, value: JSON.parse(JSON.stringify(value))
  });
  add("Trace request target identity and selection only; does not establish file existence, historical changes or rationale.",
    { source: "trace-target", file: timeline.file, provider: timeline.provider, lineRange: timeline.lineRange });
  const commits = new Map<string, NonNullable<DecisionTimeline["originalCommit"]>>();
  for (const commit of [timeline.originalCommit, timeline.focusCommit, ...(timeline.evolution?.recentCommits ?? [])]) {
    // Prefer original/focus records over a later capped evolution sample.
    if (commit?.sha && !commits.has(commit.sha)) commits.set(commit.sha, commit);
  }
  for (const commit of commits.values()) add(
    "Sampled commit metadata and exact message for the traced file. A title/message states only that account; without an attached target patch it does not prove which guard/function was added, original introduction, motive beyond the message, or exhaustive history.",
    { source: `commit:${commit.sha}`, sha: commit.sha, author: commit.author, date: commit.date,
      message: commit.message, htmlUrl: commit.htmlUrl, introductionVerified: false }
  );
  if (timeline.introducingDiffSummary) {
    const diff = timeline.introducingDiffSummary;
    add("Observed sampled commit diff metadata. Only an attached target patch establishes its actual changed lines; aggregate file counts do not identify a function/guard addition or original introduction. A rename is not an introduction.",
      { source: `commit:${timeline.originalCommit?.sha ?? "unknown"}:diff`, filesChanged: diff.filesChanged,
        insertions: diff.insertions, deletions: diff.deletions, fileChange: diff.fileChange,
        patchExcerpt: diff.patchExcerpt, introductionVerified: false });
  }
  const pr = timeline.linkedPR;
  if (pr) {
    add("Attached PR/MR metadata and exact description. Its title, link, merged state or approval does not establish a rationale, rejected alternatives, exact target changes or current decision status. An explicit description states only its historical account.",
      { source: `pr:${pr.number}`, number: pr.number, title: pr.title, description: pr.description,
        state: pr.state, htmlUrl: pr.htmlUrl });
    for (const review of pr.reviews) add("Exact attached PR/MR review text and historical participant role. Approval/participation does not establish current responsibility, availability or rationale unless explicitly stated in the text.",
      { source: `pr:${pr.number}:review:${review.id}`, author: review.author, body: review.body,
        kind: review.kind, path: review.path, line: review.line, createdAt: review.createdAt });
    if (pr.approvers.length) add("Listed historical PR/MR approvers only; not reasons, current owners, required approvers or available contacts.",
      { source: `pr:${pr.number}:approvers`, approvers: pr.approvers });
  }
  for (const message of timeline.slackThread?.messages ?? []) add("Exact attached historical Slack message. Establishes only the attributed statement; not implementation, consensus, current status or ownership beyond explicit evidence.",
    { source: `slack:${timeline.slackThread!.channelId}:${message.ts}`, user: message.user, text: message.text, ts: message.ts });
  for (const [index, message] of (timeline.teamsThread?.messages ?? []).entries()) add("Exact attached historical Teams message; attributed statement only, not implementation or current responsibility.",
    { source: `teams:${timeline.teamsThread!.channelId}:${index}`, ...message });
  for (const ticket of timeline.jiraTickets ?? []) add("Exact attached Jira fields. Requirements/criteria describe the ticket, not proof of execution, current implementation or responsibility beyond supplied fields.",
    { source: `jira:${ticket.key}`, key: ticket.key, summary: ticket.summary,
      description: ticket.description, acceptanceCriteria: ticket.acceptanceCriteria, htmlUrl: ticket.htmlUrl });
  const search = timeline.integrationSearch;
  for (const issue of search?.jira?.issues ?? []) add("Jira search-result metadata only; ticket description, acceptance criteria and discussion are not attached by this record.",
    { source: `jira-search:${issue.key}`, ...issue });
  for (const page of search?.confluence?.pages ?? []) add("Confluence search result and exact available excerpt only; full page body is not attached. Title/link does not establish an ADR's contents or recorded decision.",
    { source: `confluence:${page.id}`, ...page });
  for (const page of search?.notion?.pages ?? []) add("Notion search-result title/link only; page body and decision rationale are not attached.",
    { source: `notion:${page.id}`, id: page.id, title: page.title, url: page.url });
  for (const doc of search?.googleDocs?.documents ?? []) add("Google Docs search-result title/link only; document body and decision rationale are not attached.",
    { source: `google-docs:${doc.id}`, id: doc.id, title: doc.title, url: doc.url });
  for (const [index, message] of (search?.slack?.messages ?? []).entries()) add("Exact attached Slack search-result text; bounded search hit only, not an exhaustive discussion or consensus.",
    { source: `slack-search:${index}`, ...message });
  for (const [index, message] of (search?.teams?.messages ?? []).entries()) add("Exact attached Teams search-result text; bounded search hit only, not an exhaustive discussion or consensus.",
    { source: `teams-search:${index}`, ...message });
  return { windows: windows.map(window => ({ ...window })), facts };
}
