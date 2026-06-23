export type TraceEvidenceRelevance = "direct" | "linked";

export type TraceEvidenceMatchOptions = {
  prNumber?: number;
  file: string;
  issueKeys: string[];
  githubIssueNumbers?: number[];
};

export function extractGitHubIssueNumbers(text: string, excludePrNumber?: number): number[] {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/gi)) {
    numbers.add(Number(match[1]));
  }
  for (const match of text.matchAll(/\/issues\/(\d+)\b/gi)) {
    numbers.add(Number(match[1]));
  }
  if (excludePrNumber) {
    numbers.delete(excludePrNumber);
  }
  return [...numbers];
}

export function textReferencesGitHubIssues(text: string, issueNumbers: number[]): boolean {
  if (issueNumbers.length === 0) {
    return false;
  }
  return issueNumbers.some((issueNumber) => {
    const n = String(issueNumber);
    return (
      new RegExp(`issues/${n}(?!\\d)`, "i").test(text) ||
      new RegExp(`#${n}(?!\\d)`, "i").test(text)
    );
  });
}

export function buildSlackSearchQueries(input: {
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  pullOwner?: string;
  pullRepo?: string;
  issueKeys?: string[];
}): string[] {
  const { prNumber, prTitle, prBody, pullOwner, pullRepo, issueKeys = [] } = input;
  const queries: string[] = [];
  const githubIssues = extractGitHubIssueNumbers(prBody ?? "", prNumber);

  if (prNumber) {
    queries.push(`PR #${prNumber}`);
    queries.push(`pull/${prNumber}`);
    queries.push(`#${prNumber}`);
  }
  if (pullOwner && pullRepo && prNumber) {
    queries.push(`${pullOwner}/${pullRepo}/pull/${prNumber}`);
    queries.push(`github.com/${pullOwner}/${pullRepo}/pull/${prNumber}`);
  }
  for (const issueNumber of githubIssues) {
    queries.push(`issues/${issueNumber}`);
    if (pullOwner && pullRepo) {
      queries.push(`github.com/${pullOwner}/${pullRepo}/issues/${issueNumber}`);
    }
  }
  if (prTitle) {
    const title = prTitle.replace(/\s*\(#\d+\)\s*$/, "").trim();
    if (title.length >= 8) {
      queries.push(title.slice(0, 80));
    }
  }
  queries.push(...issueKeys);
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

export function parseGithubPullUrl(htmlUrl?: string): { owner?: string; repo?: string } {
  const match = htmlUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i);
  if (!match) {
    return {};
  }
  return { owner: match[1], repo: match[2] };
}

export function fileStemFromPath(file: string): string {
  return file.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
}

export function textReferencesPr(text: string, prNumber: number): boolean {
  const n = String(prNumber);
  const patterns = [
    new RegExp(`#${n}(?!\\d)`, "i"),
    new RegExp(`\\bpr\\s*#?${n}(?!\\d)\\b`, "i"),
    new RegExp(`pull/${n}(?!\\d)`, "i"),
    new RegExp(`pull request #${n}(?!\\d)`, "i")
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function textReferencesIssueKey(text: string, issueKeys: string[]): boolean {
  if (issueKeys.length === 0) {
    return false;
  }
  const upper = text.toUpperCase();
  return issueKeys.some((key) => upper.includes(key.toUpperCase()));
}

export function textReferencesFile(text: string, file: string): boolean {
  const stem = fileStemFromPath(file);
  return stem.length >= 3 && text.toLowerCase().includes(stem);
}

export function isNoiseIntegrationHit(text: string): boolean {
  return /archaeology queries|dm search opt-in|test bot|coop ai test bot/i.test(text);
}

export function isIntegrationSearchHitRelevant(text: string, options: TraceEvidenceMatchOptions): boolean {
  if (isNoiseIntegrationHit(text)) {
    return false;
  }
  const { prNumber, file, issueKeys, githubIssueNumbers = [] } = options;
  if (prNumber) {
    return (
      textReferencesPr(text, prNumber) ||
      textReferencesFile(text, file) ||
      textReferencesGitHubIssues(text, githubIssueNumbers)
    );
  }
  if (issueKeys.length > 0 && textReferencesIssueKey(text, issueKeys)) {
    return true;
  }
  return textReferencesFile(text, file);
}

export function integrationRelevanceFromHit(text: string, file: string): TraceEvidenceRelevance {
  if (textReferencesFile(text, file)) {
    return "direct";
  }
  return "linked";
}

export function threadMeetsRelevanceBar(
  messages: Array<{ text: string }>,
  options: TraceEvidenceMatchOptions
): boolean {
  if (messages.length === 0) {
    return false;
  }
  const combined = messages.map((message) => message.text).join("\n");
  return isIntegrationSearchHitRelevant(combined, options);
}
