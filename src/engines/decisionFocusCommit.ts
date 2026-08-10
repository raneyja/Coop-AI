import type { CommitInfo } from "../api/codeHosts/types";
import type { DecisionCommit, LineRange } from "../types/decisionTimeline";
import {
  isMegaDriveByCommit,
  scoreCommitMessageForTraceFocus
} from "./traceFileGrounding";

const WEAK_DECISION_COMMIT_MESSAGE_RE = /^(wip|fix|update|changes?|misc|tmp|test|merge|refactor)\b/i;

/** How many newest file-history commits (excluding intro) to score for focus. */
export const TRACE_FOCUS_SCORE_WINDOW = 25;

/** How many recent commits to surface in Evolution UI. */
export const TRACE_EVOLUTION_DISPLAY_LIMIT = 3;

export type FocusDecisionQuality = "aligned" | "weak" | "unknown";

export type SelectFocusCommitResult = {
  commit: DecisionCommit;
  quality: FocusDecisionQuality;
  score: number;
  /** True when selected commit looks like a mega drive-by (should not be rationale). */
  isMegaDriveBy: boolean;
};

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

function scoreCommit(
  commit: DecisionCommit,
  focusTerms: string[],
  symbolTerms: string[]
): number {
  return scoreCommitMessageForTraceFocus(commit.message, focusTerms, symbolTerms);
}

/**
 * Evidence-only re-rank among already-loaded candidates (Phase C).
 * Deterministic — no LLM. Prefer higher ask/file score, then recency among ties.
 */
export function rerankTraceFocusCandidates(options: {
  introduction: DecisionCommit;
  candidates: DecisionCommit[];
  focusTerms: string[];
  symbolTerms?: string[];
  filesChangedBySha?: Record<string, number | undefined>;
}): SelectFocusCommitResult {
  const focusTerms = options.focusTerms.filter((term) => term.trim().length >= 3);
  const symbolTerms = (options.symbolTerms ?? []).filter((term) => term.trim().length >= 3);
  const pool = [options.introduction, ...options.candidates.filter((c) => c.sha !== options.introduction.sha)];

  if (focusTerms.length === 0 && symbolTerms.length === 0) {
    const highSignal = options.candidates.find((commit) => isHighSignalCommitMessage(commit.message));
    const commit = highSignal ?? options.candidates[0] ?? options.introduction;
    return {
      commit,
      quality: "unknown",
      score: 0,
      isMegaDriveBy: isMegaDriveByCommit({
        filesChanged: options.filesChangedBySha?.[commit.sha],
        focusScore: 0,
        message: commit.message
      })
    };
  }

  const ranked = pool
    .map((commit) => {
      const score = scoreCommit(commit, focusTerms, symbolTerms);
      const filesChanged = options.filesChangedBySha?.[commit.sha];
      const mega = isMegaDriveByCommit({
        filesChanged,
        focusScore: score,
        message: commit.message
      });
      return { commit, score, mega };
    })
    .filter((entry) => entry.score > 0 && !entry.mega)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.commit.sha === options.introduction.sha) {
        return 1;
      }
      if (b.commit.sha === options.introduction.sha) {
        return -1;
      }
      return 0;
    });

  if (ranked[0]) {
    return {
      commit: ranked[0].commit,
      quality: "aligned",
      score: ranked[0].score,
      isMegaDriveBy: false
    };
  }

  // Concrete ask, no aligned candidate: keep introduction as provenance (not a mega "why").
  const introScore = scoreCommit(options.introduction, focusTerms, symbolTerms);
  return {
    commit: options.introduction,
    quality: "weak",
    score: introScore,
    isMegaDriveBy: isMegaDriveByCommit({
      filesChanged: options.filesChangedBySha?.[options.introduction.sha],
      focusScore: introScore,
      message: options.introduction.message
    })
  };
}

/**
 * Full-file traces prefer a commit aligned with the open file + user ask when possible.
 * Line selections keep the blame introduction as the focus.
 *
 * Z3 Gate A PASS: auth mega-PR body must not align via "empty state" — subject + symbol only.
 */
export function selectFocusCommit(options: {
  lineRange?: LineRange;
  introduction: DecisionCommit;
  recentCommits: DecisionCommit[];
  focusTerms?: string[];
  symbolTerms?: string[];
  filesChangedBySha?: Record<string, number | undefined>;
}): DecisionCommit {
  return selectFocusCommitWithMeta(options).commit;
}

export function selectFocusCommitWithMeta(options: {
  lineRange?: LineRange;
  introduction: DecisionCommit;
  recentCommits: DecisionCommit[];
  focusTerms?: string[];
  symbolTerms?: string[];
  filesChangedBySha?: Record<string, number | undefined>;
}): SelectFocusCommitResult {
  if (options.lineRange) {
    const score = scoreCommit(
      options.introduction,
      options.focusTerms ?? [],
      options.symbolTerms ?? []
    );
    return {
      commit: options.introduction,
      quality: "aligned",
      score,
      isMegaDriveBy: false
    };
  }

  return rerankTraceFocusCandidates({
    introduction: options.introduction,
    candidates: options.recentCommits,
    focusTerms: options.focusTerms ?? [],
    symbolTerms: options.symbolTerms,
    filesChangedBySha: options.filesChangedBySha
  });
}

/** Newest-first history → up to `limit` commits after introduction. */
export function pickRecentEvolutionCommits(
  history: CommitInfo[],
  introducingSha: string | undefined,
  limit = TRACE_EVOLUTION_DISPLAY_LIMIT
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
