import type { IntegrationDocsEnrichmentContext, IntegrationPageForEnrichment } from "./knowledgeGapsEnrichment";
import { formatReviewedPageLine } from "./knowledgeGapsEnrichment";

export const RELATED_DOCUMENTATION_HEADING = "**Related documentation**";
export const MAX_COMPACT_DOC_TITLES = 3;

const DOC_REVIEW_HEADINGS = [
  "**Notion pages reviewed**",
  "**Confluence pages reviewed**",
  "**Google Docs reviewed**"
];

const OUT_OF_SCOPE_HEADING = "**Out-of-scope @ attachments**";

type ScoredPage = IntegrationPageForEnrichment & { score: number; provider: string };

/** Rank attached doc pages by relevance to the active file path. */
export function scorePageRelevance(page: IntegrationPageForEnrichment, activeFile?: string): number {
  const title = page.title.toLowerCase();
  const haystack = `${title} ${page.excerpt ?? ""}`.toLowerCase();
  let score = 0;

  if (activeFile?.trim()) {
    const normalized = activeFile.trim().replace(/^\/+/, "").toLowerCase();
    if (haystack.includes(normalized)) {
      score += 20;
    }
    const basename = normalized.split("/").pop() ?? "";
    const stem = basename.replace(/\.[^.]+$/, "");
    if (stem && haystack.includes(stem.toLowerCase())) {
      score += 12;
    }
    const camelSpaced = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    if (camelSpaced.includes(" ") && haystack.includes(camelSpaced)) {
      score += 8;
    }
  }

  if (/\b(adr|architecture decision)\b/.test(haystack)) {
    score += 6;
  }
  if (/\barchitecture overview\b/.test(haystack)) {
    score += 4;
  }
  if (/\bintegrations?\b/.test(haystack)) {
    score += 3;
  }

  return score;
}

export function topRelevantPages(
  pages: IntegrationPageForEnrichment[],
  activeFile: string | undefined,
  limit = MAX_COMPACT_DOC_TITLES
): IntegrationPageForEnrichment[] {
  return [...pages]
    .sort((a, b) => scorePageRelevance(b, activeFile) - scorePageRelevance(a, activeFile))
    .slice(0, limit);
}

export function countAttachedDocPages(context?: IntegrationDocsEnrichmentContext): number {
  return (
    (context?.confluencePages?.length ?? 0) +
    (context?.notionPages?.length ?? 0) +
    (context?.googleDocs?.length ?? 0)
  );
}

function allAttachedPages(context: IntegrationDocsEnrichmentContext): ScoredPage[] {
  const pages: ScoredPage[] = [];
  for (const page of context.confluencePages ?? []) {
    pages.push({ ...page, score: 0, provider: "Confluence" });
  }
  for (const page of context.notionPages ?? []) {
    pages.push({ ...page, score: 0, provider: "Notion" });
  }
  for (const page of context.googleDocs ?? []) {
    pages.push({ ...page, score: 0, provider: "Google Docs" });
  }
  return pages.map((page) => ({ ...page, score: scorePageRelevance(page, context.activeFile) }));
}

export function buildCompactRelatedDocumentationBlock(
  context: IntegrationDocsEnrichmentContext,
  maxPages = MAX_COMPACT_DOC_TITLES
): string | undefined {
  const total = countAttachedDocPages(context);
  if (total === 0) {
    return undefined;
  }

  const ranked = allAttachedPages(context)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages);
  const lines = [RELATED_DOCUMENTATION_HEADING, ""];
  if (total > maxPages) {
    lines.push(
      `Top ${maxPages} of ${total} attached pages for this scope (full list in the Sources card above).`
    );
    lines.push("");
  }
  for (const page of ranked) {
    lines.push(formatReviewedPageLine(page, context.activeFile));
  }
  return lines.join("\n");
}

/** Remove empty out-of-scope sections the model sometimes emits anyway. */
export function stripEmptyOutOfScopeSection(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const pattern = new RegExp(
    `\\n${escapeRegExp(OUT_OF_SCOPE_HEADING)}\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*]|$)`,
    "i"
  );
  return normalized.replace(pattern, (match, body: string) => {
    const trimmed = body
      .replace(/^[-*]\s+/gm, "")
      .replace(/\*\*/g, "")
      .trim()
      .toLowerCase();
    if (
      !trimmed ||
      /^no out-of-scope attachments were identified\.?$/.test(trimmed) ||
      /^not applicable\.?$/.test(trimmed) ||
      /^none\.?$/.test(trimmed) ||
      /^n\/a\.?$/.test(trimmed)
    ) {
      return "";
    }
    return match;
  });
}

/** Collapse verbose per-provider doc lists under narrative sections (e.g. Blast Radius APIs). */
export function collapseVerboseDocReviewSections(
  content: string,
  context?: IntegrationDocsEnrichmentContext
): string {
  if (!context || countAttachedDocPages(context) === 0) {
    return content;
  }

  let result = content.replace(/\r\n/g, "\n");
  const compact = buildCompactRelatedDocumentationBlock(context);
  if (!compact) {
    return result;
  }

  const apisPattern =
    /(?:^|(\n))(\*\*APIs & integrations\*\*\s*\n)([\s\S]*?)(?=\n\*\*Operational risk\*\*|\n\*\*Testing surfaces\*\*|\n\*\*Sources\*\*|$)/i;
  const apisMatch = apisPattern.exec(result);
  if (apisMatch) {
    const body = apisMatch[3].trim();
    const hasVerboseLists = DOC_REVIEW_HEADINGS.some((heading) =>
      body.toLowerCase().includes(heading.replace(/\*\*/g, "").toLowerCase())
    );
    if (hasVerboseLists || body.split("\n").filter((line) => line.trim().startsWith("-")).length > MAX_COMPACT_DOC_TITLES + 2) {
      const prefix = apisMatch[1] ?? "";
      const replacement = `${prefix}${apisMatch[2]}${compact}\n`;
      result = result.slice(0, apisMatch.index) + replacement + result.slice(apisMatch.index! + apisMatch[0].length);
    }
  }

  for (const heading of DOC_REVIEW_HEADINGS) {
    const pattern = new RegExp(
      `(\\n${escapeRegExp(heading)}\\s*\\n)([\\s\\S]*?)(?=\\n\\*\\*[^*]|\\n${escapeRegExp(RELATED_DOCUMENTATION_HEADING)}|$)`,
      "i"
    );
    result = result.replace(pattern, "");
  }

  if (result.includes(RELATED_DOCUMENTATION_HEADING)) {
    return result.replace(/\n{3,}/g, "\n\n").trim();
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

/** Insert compact related docs after **How the open file fits** for Understand Repo. */
export function injectRelatedDocsAfterActiveFileSection(
  content: string,
  context?: IntegrationDocsEnrichmentContext
): string {
  if (!context?.activeFile?.trim() || countAttachedDocPages(context) === 0) {
    return content;
  }

  const compact = buildCompactRelatedDocumentationBlock(context);
  if (!compact || content.includes(RELATED_DOCUMENTATION_HEADING)) {
    return content;
  }

  const heading = "**How the open file fits**";
  const index = content.indexOf(heading);
  if (index < 0) {
    return content;
  }

  const afterHeading = content.indexOf("\n", index + heading.length);
  if (afterHeading < 0) {
    return content;
  }

  const nextSection = content.slice(afterHeading + 1).search(/\n\*\*[^*]+\*\*\s*\n/);
  const insertAt = nextSection >= 0 ? afterHeading + 1 + nextSection : content.length;

  return `${content.slice(0, insertAt).trimEnd()}\n\n${compact}\n${content.slice(insertAt)}`.replace(/\n{3,}/g, "\n\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function enrichCompactIntegrationDocs(
  content: string,
  context: IntegrationDocsEnrichmentContext | undefined,
  options: { mode: "understand-repo" | "blast-radius" }
): string {
  let result = stripEmptyOutOfScopeSection(content);
  if (!context) {
    return result;
  }
  if (options.mode === "understand-repo") {
    result = injectRelatedDocsAfterActiveFileSection(result, context);
  } else {
    result = collapseVerboseDocReviewSections(result, context);
  }
  return result;
}
