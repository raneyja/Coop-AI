/**
 * Intent detection for repository *facts* — questions answered from the indexed
 * workspace inventory rather than from a retrieval sample.
 *
 * Keep narrow: "which files use auth?" and "how many files import X?" are
 * implementation questions and must still run search.
 */

function normalize(queryText: string | undefined): string {
  return queryText?.trim().toLowerCase() ?? "";
}

/** "how many files", "file count", "how big is this repo" — countable inventory. */
export function isRepoFileCountQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }

  if (/\bfile count\b/.test(q) || /\btotal (number of )?files\b/.test(q) || /\bnumber of files\b/.test(q)) {
    return true;
  }

  if (/\bcount (all |the )?files\b/.test(q) && !/\bcount (all |the )?files that\b/.test(q)) {
    return true;
  }

  if (/\bhow many files\b/.test(q)) {
    // Implementation questions: "how many files import/call/use X"
    if (
      /\bhow many files\b\s+(import|export|call|use|reference|contain|include|mention|match|define|implement)\b/.test(
        q
      )
    ) {
      return false;
    }
    if (
      /\b(in|inside|within)\b/.test(q) ||
      /\b(this|the)\s+(repo|repository|project|codebase)\b/.test(q) ||
      /\bhow many files\s*(are there)?\s*\??\s*$/.test(q) ||
      /\bdoes (this|the)\s+(repo|repository|project|codebase)\s+have\b/.test(q)
    ) {
      return true;
    }
    return false;
  }

  if (/\b(list|show|dump) (all |every )?files\b/.test(q) && /\b(repo|repository|project|codebase)\b/.test(q)) {
    return true;
  }

  if (/\bhow (big|large) is (this |the )?(repo|repository|project|codebase)\b/.test(q)) {
    return true;
  }

  return false;
}

/**
 * "how many lines of code", "LOC", "total lines". Repo-wide size questions that
 * a 3-file retrieval sample can never answer — the model would invent a number.
 */
export function isRepoLineCountQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }

  // Scoped reads ("how many lines in this function") are implementation questions.
  if (/\blines?\b[^?]*\b(in|of)\s+(this\s+|the\s+)?(file|function|method|class|component|module)\b/.test(q)) {
    return false;
  }

  return (
    /\bline count\b/.test(q) ||
    /\btotal (number of )?lines\b/.test(q) ||
    /\bnumber of lines\b/.test(q) ||
    /\bhow many lines\b/.test(q) ||
    /\blines of code\b/.test(q) ||
    /\b(loc|sloc)\b/.test(q)
  );
}

/** Any countable repository total (files or lines). */
export function isRepoInventoryQuery(queryText: string | undefined): boolean {
  return isRepoFileCountQuery(queryText) || isRepoLineCountQuery(queryText);
}

/** Broader structure questions that need a live top-level tree, not search snippets. */
export function isRepoStructureQuery(queryText: string | undefined): boolean {
  if (isRepoInventoryQuery(queryText)) {
    return true;
  }
  const q = normalize(queryText);
  if (!q) {
    return false;
  }
  if (/\b(is this|is it) (a )?monorepo\b/.test(q)) {
    return true;
  }
  if (
    /\b(repo|repository|project|codebase)\s+structure\b/.test(q) ||
    /\bstructure of (this |the )?(repo|repository|project|codebase)\b/.test(q)
  ) {
    return true;
  }
  if (/\b(top[- ]level|root) (dirs|directories|folders|files)\b/.test(q)) {
    return true;
  }
  if (/\b(list|show) (the )?(top[- ]level |root )?(dirs|directories|folders)\b/.test(q)) {
    return true;
  }
  return false;
}

/** True when we need a live top-level listing (monorepo / structure), not only totals. */
export function needsRepoTreeOverview(queryText: string | undefined): boolean {
  return isRepoStructureQuery(queryText) && !isRepoInventoryQuery(queryText);
}

export type RepoFactNeeds = {
  fileCount: boolean;
  lineCount: boolean;
  treeOverview: boolean;
};

/** What the workspace must resolve for this turn. */
export function repoFactNeeds(queryText: string | undefined): RepoFactNeeds {
  const lineCount = isRepoLineCountQuery(queryText);
  return {
    // Line-count answers read better alongside the file total, and both come from one lookup.
    fileCount: isRepoFileCountQuery(queryText) || lineCount,
    lineCount,
    treeOverview: needsRepoTreeOverview(queryText)
  };
}

export function hasRepoFactNeed(needs: RepoFactNeeds): boolean {
  return needs.fileCount || needs.lineCount || needs.treeOverview;
}
