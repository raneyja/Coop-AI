import type { CommitInfo } from "../api/codeHosts/types";
import type { DecisionCommit, LineRange } from "../types/decisionTimeline";
import { scoreTextForTraceFocus } from "./traceFileGrounding";

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
 * Full-file traces prefer a commit aligned with the open file + user ask when possible.
 * Line selections keep the blame introduction as the focus.
 * Uses commits already loaded for evolution — no extra API calls.
 */
export function selectFocusCommit(options: {
  lineRange?: LineRange;
  introduction: DecisionCommit;
  recentCommits: DecisionCommit[];
  /** Terms from open file stem, user ask, and snippet — rank commits toward that ask. */
  focusTerms?: string[];
}): DecisionCommit {
  if (options.lineRange) {
    return options.introduction;
  }

  const introSha = options.introduction.sha;
  const recent = options.recentCommits.filter((commit) => commit.sha !== introSha);
  const focusTerms = (options.focusTerms ?? []).filter((term) => term.trim().length >= 3);

  if (focusTerms.length > 0) {
    const ranked = [options.introduction, ...recent]
      .map((commit) => ({
        commit,
        score: scoreTextForTraceFocus(commit.message, focusTerms)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // Prefer recent evolution over birth when scores tie.
        if (a.commit.sha === introSha) {
          return 1;
        }
        if (b.commit.sha === introSha) {
          return -1;
        }
        return 0;
      });
    if (ranked[0]) {
      return ranked[0].commit;
    }
  }

  if (!recent.length) {
    return options.introduction;
  }
  const highSignal = recent.find((commit) => isHighSignalCommitMessage(commit.message));
  return highSignal ?? recent[0];
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
