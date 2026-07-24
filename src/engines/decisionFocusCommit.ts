import type { CommitInfo } from "../api/codeHosts/types";
import type { DecisionCommit, LineRange } from "../types/decisionTimeline";

const WEAK_DECISION_COMMIT_MESSAGE_RE = /^(wip|fix|update|changes?|misc|tmp|test|merge|refactor)\b/i;

export function isHighSignalCommitMessage(message: string): boolean {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean).length;
  return words >= 6 && cleaned.length >= 30 && !WEAK_DECISION_COMMIT_MESSAGE_RE.test(cleaned);
}

function mapCommit(commit: CommitInfo): DecisionCommit {
  return {
    sha: commit.sha,
    author: commit.authorLogin ? `@${commit.authorLogin}` : commit.author,
    date: commit.date,
    message: commit.message,
    htmlUrl: commit.htmlUrl
  };
}

/**
 * Full-file traces prefer a recent post-introduction commit for rationale enrichment.
 * Line selections keep the blame introduction as the focus.
 * Uses commits already loaded for evolution — no extra API calls.
 */
export function selectFocusCommit(options: {
  lineRange?: LineRange;
  introduction: DecisionCommit;
  recentCommits: DecisionCommit[];
}): DecisionCommit {
  if (options.lineRange) {
    return options.introduction;
  }
  const introSha = options.introduction.sha;
  const candidates = options.recentCommits.filter((commit) => commit.sha !== introSha);
  if (!candidates.length) {
    return options.introduction;
  }
  const highSignal = candidates.find((commit) => isHighSignalCommitMessage(commit.message));
  return highSignal ?? candidates[0];
}

/** Newest-first history → up to `limit` commits after introduction. */
export function pickRecentEvolutionCommits(
  history: CommitInfo[],
  introducingSha: string | undefined,
  limit = 3
): DecisionCommit[] {
  const picked: DecisionCommit[] = [];
  for (const entry of history) {
    if (introducingSha && entry.sha === introducingSha) {
      continue;
    }
    picked.push(mapCommit(entry));
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}
