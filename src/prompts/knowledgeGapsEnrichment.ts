import {
  MAX_KNOWLEDGE_GAP_REVIEWED_PAGES,
  MAX_KNOWLEDGE_GAP_SUBSECTIONS
} from "./knowledgeGapsSynthesis";

export type IntegrationPageForEnrichment = {
  title: string;
  excerpt?: string;
  htmlUrl?: string;
};

export type KnowledgeGapScanGap = {
  type?: string;
  message?: string;
  file?: string;
};

export type IntegrationDocsEnrichmentContext = {
  confluencePages?: IntegrationPageForEnrichment[];
  notionPages?: IntegrationPageForEnrichment[];
  googleDocs?: IntegrationPageForEnrichment[];
  activeFile?: string;
};

export type KnowledgeGapsEnrichmentContext = IntegrationDocsEnrichmentContext & {
  jobScanGaps?: KnowledgeGapScanGap[];
};

const CONFLUENCE_REVIEWED_HEADING = "**Confluence pages reviewed**";
const NOTION_REVIEWED_HEADING = "**Notion pages reviewed**";
const GOOGLE_DOCS_REVIEWED_HEADING = "**Google Docs reviewed**";
const RECOMMENDED_NEXT_STEP_HEADING = "**Recommended next step**";

const DOCUMENTATION_SCAN_GAP_TYPES = new Set(["missing_docs", "impact_unknown"]);
const INTEGRATION_SCAN_GAP_TYPES = new Set([
  "integration_unknown",
  "ops_unknown",
  "missing_runbook",
  "missing_ops"
]);

const FORBIDDEN_SUBSECTION_HEADERS = new Set([
  "documentation coverage",
  "confluence pages reviewed",
  "notion pages reviewed",
  "google docs reviewed"
]);

const FIELD_LINE_RE = /^(?:[-*]\s+)?(?:\*\*)?(Open question|What to check)(?:\*\*)?:\s*(.*)$/gim;

const FILE_PATH_RE =
  /\b((?:src|docs|examples|test|integration|lib)\/[\w./-]+|[A-Za-z][\w.-]*\.(?:ts|tsx|js|jsx|py|md|json|yml|yaml))\b/g;

function normalizeFieldLines(content: string): string {
  return content.replace(FIELD_LINE_RE, (_, label, body) => {
    const normalized = label.toLowerCase() === "what to check" ? "What to check" : "Open question";
    const cleaned = body.replace(/^\*\*\s*/, "").trim();
    return cleaned ? `- **${normalized}:** ${cleaned}` : `- **${normalized}:**`;
  });
}

function stripBoldHeading(line: string): string {
  const match = line.trim().match(/^\*\*([^*]+)\*\*$/);
  return match ? match[1].trim().toLowerCase() : line.trim().toLowerCase();
}

function isMainSectionLine(line: string): boolean {
  const match = line.trim().match(/^\*\*([^*]+)\*\*$/);
  if (!match) {
    return false;
  }
  const title = match[1].trim().toLowerCase();
  return (
    title === "summary" ||
    title === "documentation gaps" ||
    title === "ownership & maintenance" ||
    title === "integration & operations" ||
    title === "recommended next step" ||
    title === "recommended next steps" ||
    title === "out-of-scope @ attachments" ||
    title === "sources" ||
    title === "open questions" ||
    title === "key unknowns"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInsideMarkdown(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if ((before.match(/`/g) ?? []).length % 2 === 1) {
    return true;
  }
  const lastOpenBracket = before.lastIndexOf("[");
  const lastCloseBracket = before.lastIndexOf("]");
  if (lastOpenBracket > lastCloseBracket) {
    return true;
  }
  const lastOpenParen = before.lastIndexOf("(");
  const lastCloseParen = before.lastIndexOf(")");
  if (lastOpenParen > lastCloseParen) {
    return true;
  }
  return false;
}

function linkifyFilePaths(text: string): string {
  return text.replace(FILE_PATH_RE, (match, _group, offset, full) => {
    if (isInsideMarkdown(full, offset)) {
      return match;
    }
    return `\`${match}\``;
  });
}

function linkifyPageTitles(text: string, pages: IntegrationPageForEnrichment[]): string {
  let result = text;
  const sorted = [...pages].sort((a, b) => b.title.length - a.title.length);

  for (const page of sorted) {
    if (!page.htmlUrl) {
      continue;
    }
    const quoted = new RegExp(`"(${escapeRegExp(page.title)})"`, "g");
    result = result.replace(quoted, (_match, _title, offset, full) => {
      if (isInsideMarkdown(full, offset)) {
        return _match;
      }
      return `[${page.title}](${page.htmlUrl})`;
    });
    const titled = new RegExp(`(?<!\\[)${escapeRegExp(page.title)}(?!\\])`, "g");
    result = result.replace(titled, (match, offset, full) => {
      if (isInsideMarkdown(full, offset)) {
        return match;
      }
      return `[${page.title}](${page.htmlUrl})`;
    });
  }

  return result;
}

function confluenceTitleHint(title: string, excerpt: string | undefined, activeFile?: string): string {
  const haystack = `${title} ${excerpt ?? ""}`.toLowerCase();
  const fileRef = activeFile ? `\`${activeFile}\`` : "the active file";

  if (/\b(runbook|playbook|on-?call|oncall|incident)\b/.test(haystack)) {
    return `Operational runbook or on-call reference; check procedures affecting ${fileRef}.`;
  }
  if (/\b(adr|architecture decision)\b/.test(haystack) || /\badrs?\b/.test(haystack)) {
    return `Architecture decision record; may explain design choices around ${fileRef}.`;
  }
  if (/\b(architecture|overview|system design)\b/.test(haystack)) {
    return `Architecture overview; useful system context around ${fileRef}.`;
  }
  return activeFile
    ? `Repo-linked page; title does not mention ${fileRef} directly.`
    : "Repo-linked documentation page; relevance to the primary target is unclear.";
}

function integrationPageNote(page: IntegrationPageForEnrichment, activeFile?: string): string {
  const excerpt = page.excerpt?.replace(/\s+/g, " ").trim();
  if (excerpt) {
    const clipped = excerpt.length > 220 ? `${excerpt.slice(0, 217)}...` : excerpt;
    if (activeFile && excerpt.toLowerCase().includes(activeFile.toLowerCase())) {
      return `Mentions \`${activeFile}\` — ${clipped}`;
    }
    return clipped;
  }
  return confluenceTitleHint(page.title, page.excerpt, activeFile);
}

export function formatReviewedPageLine(page: IntegrationPageForEnrichment, activeFile?: string): string {
  const note = linkifyFilePaths(integrationPageNote(page, activeFile));
  if (page.htmlUrl) {
    return `- [${page.title}](${page.htmlUrl}) — ${note}`;
  }
  return `- **${page.title}:** ${note}`;
}

function scoreReviewedPageRelevance(page: IntegrationPageForEnrichment, activeFile?: string): number {
  const haystack = `${page.title} ${page.excerpt ?? ""}`.toLowerCase();
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
  }
  if (/\b(adr|architecture decision|runbook|overview)\b/.test(haystack)) {
    score += 4;
  }
  return score;
}

function selectReviewedPages(
  pages: IntegrationPageForEnrichment[],
  activeFile?: string,
  limit = MAX_KNOWLEDGE_GAP_REVIEWED_PAGES
): { selected: IntegrationPageForEnrichment[]; total: number } {
  const total = pages.length;
  if (total <= limit) {
    return { selected: pages, total };
  }
  const selected = [...pages]
    .sort((a, b) => scoreReviewedPageRelevance(b, activeFile) - scoreReviewedPageRelevance(a, activeFile))
    .slice(0, limit);
  return { selected, total };
}

function buildReviewedPagesBlock(
  heading: string,
  pages: IntegrationPageForEnrichment[],
  activeFile?: string
): string {
  const { selected, total } = selectReviewedPages(pages, activeFile);
  const lines = [heading, ""];
  if (total > selected.length) {
    lines.push(
      `Top ${selected.length} of ${total} attached pages for this scope (full list in the Sources card above).`
    );
    lines.push("");
  }
  for (const page of selected) {
    lines.push(formatReviewedPageLine(page, activeFile));
  }
  return lines.join("\n");
}

export function buildConfluencePagesReviewedBlock(
  pages: IntegrationPageForEnrichment[],
  activeFile?: string
): string {
  return buildReviewedPagesBlock(CONFLUENCE_REVIEWED_HEADING, pages, activeFile);
}

export function buildNotionPagesReviewedBlock(
  pages: IntegrationPageForEnrichment[],
  activeFile?: string
): string {
  return buildReviewedPagesBlock(NOTION_REVIEWED_HEADING, pages, activeFile);
}

export function buildGoogleDocsReviewedBlock(
  documents: IntegrationPageForEnrichment[],
  activeFile?: string
): string {
  return buildReviewedPagesBlock(GOOGLE_DOCS_REVIEWED_HEADING, documents, activeFile);
}

function scanGapSubsectionTitle(gap: KnowledgeGapScanGap): string {
  const message = gap.message?.toLowerCase() ?? "";
  if (message.includes("confluence")) {
    return "Confluence documentation coverage";
  }
  if (message.includes("google docs")) {
    return "Google Docs documentation coverage";
  }
  if (message.includes("notion")) {
    return "Notion documentation coverage";
  }
  if (gap.type === "impact_unknown") {
    return "Dependency graph evidence";
  }
  if (gap.type === "missing_owner") {
    return "Ownership clarity";
  }
  return (gap.message ?? "Knowledge gap").replace(/\.$/, "");
}

export function buildScanGapSubsection(gap: KnowledgeGapScanGap, activeFile?: string): string {
  const title = scanGapSubsectionTitle(gap);
  const target = activeFile ? `\`${activeFile}\`` : "the primary target";
  const openQuestion =
    gap.type === "missing_docs"
      ? `What documentation should cover ${target} in this repository?`
      : gap.type === "impact_unknown"
        ? `What change-impact context is missing for ${target}?`
        : gap.type === "missing_owner"
          ? `Who owns maintenance and review for ${target}?`
          : `What risk does this scan gap create for ${target}?`;
  const whatToCheck = gap.message?.trim() || "Review the attached Sources card evidence.";
  return `**${title}**\n\n- **Open question:** ${openQuestion}\n- **What to check:** ${whatToCheck}`;
}

function attachedDocPageCount(context?: KnowledgeGapsEnrichmentContext): number {
  return (
    (context?.confluencePages?.length ?? 0) +
    (context?.notionPages?.length ?? 0) +
    (context?.googleDocs?.length ?? 0)
  );
}

function attachedDocSourceLabel(context?: KnowledgeGapsEnrichmentContext): string {
  if (context?.notionPages?.length) {
    return "Notion";
  }
  if (context?.confluencePages?.length) {
    return "Confluence";
  }
  if (context?.googleDocs?.length) {
    return "Google Docs";
  }
  return "attached doc";
}

function rebuildSummaryForZeroScanGaps(content: string, context?: KnowledgeGapsEnrichmentContext): string {
  const pageCount = attachedDocPageCount(context);
  const scanGaps = context?.jobScanGaps ?? [];
  if (pageCount === 0 || scanGaps.length > 0) {
    return content;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const summaryIdx = lines.findIndex((line) => stripBoldHeading(line.trim()) === "summary");
  if (summaryIdx < 0) {
    return content;
  }

  let end = summaryIdx + 1;
  while (end < lines.length && !isMainSectionLine(lines[end].trim())) {
    end += 1;
  }

  const docLabel = attachedDocSourceLabel(context);
  const summaryBody = `Automated scan found no structured gaps in this pass; attached ${docLabel} doc review (${pageCount} page(s)) suggests follow-up areas under **Documentation gaps** below.`;

  return [...lines.slice(0, summaryIdx + 1), "", summaryBody, "", ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function documentationBlocksFromContext(context?: KnowledgeGapsEnrichmentContext): string[] {
  const blocks: string[] = [];
  if (context?.notionPages?.length) {
    blocks.push(buildNotionPagesReviewedBlock(context.notionPages, context.activeFile));
  }
  if (context?.confluencePages?.length) {
    blocks.push(buildConfluencePagesReviewedBlock(context.confluencePages, context.activeFile));
  }
  if (context?.googleDocs?.length) {
    blocks.push(buildGoogleDocsReviewedBlock(context.googleDocs, context.activeFile));
  }
  let docGapCount = 0;
  for (const gap of context?.jobScanGaps ?? []) {
    if (!gap.type || !DOCUMENTATION_SCAN_GAP_TYPES.has(gap.type)) {
      continue;
    }
    if (docGapCount >= MAX_KNOWLEDGE_GAP_SUBSECTIONS) {
      break;
    }
    blocks.push(buildScanGapSubsection(gap, context?.activeFile));
    docGapCount += 1;
  }
  return blocks;
}

function ownershipBlocksFromContext(context?: KnowledgeGapsEnrichmentContext): string[] {
  return (context?.jobScanGaps ?? [])
    .filter((gap) => gap.type === "missing_owner")
    .slice(0, MAX_KNOWLEDGE_GAP_SUBSECTIONS)
    .map((gap) => buildScanGapSubsection(gap, context?.activeFile));
}

function integrationBlocksFromContext(context?: KnowledgeGapsEnrichmentContext): string[] {
  return (context?.jobScanGaps ?? [])
    .filter((gap) => gap.type && INTEGRATION_SCAN_GAP_TYPES.has(gap.type))
    .slice(0, MAX_KNOWLEDGE_GAP_SUBSECTIONS)
    .map((gap) => buildScanGapSubsection(gap, context?.activeFile));
}

function rebuildDocumentationGapsSection(content: string, blocks: string[]): string {
  if (blocks.length === 0) {
    return content;
  }
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const docIdx = lines.findIndex((line) => stripBoldHeading(line) === "documentation gaps");
  const sectionLines = ["**Documentation gaps**", "", ...blocks.flatMap((block) => [block, ""])];

  if (docIdx === -1) {
    const summaryIdx = lines.findIndex((line) => stripBoldHeading(line) === "summary");
    let insertAt = lines.length;
    if (summaryIdx >= 0) {
      insertAt = summaryIdx + 1;
      while (insertAt < lines.length && lines[insertAt].trim() !== "" && !isMainSectionLine(lines[insertAt].trim())) {
        insertAt += 1;
      }
    }
    return [...lines.slice(0, insertAt), "", ...sectionLines, ...lines.slice(insertAt)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  let end = docIdx + 1;
  while (end < lines.length && lines[end].trim() === "") {
    end += 1;
  }
  while (end < lines.length && !isMainSectionLine(lines[end].trim())) {
    end += 1;
  }

  return [...lines.slice(0, docIdx), ...sectionLines, ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rebuildMainSection(content: string, heading: string, blocks: string[]): string {
  if (blocks.length === 0) {
    return content;
  }

  const normalizedHeading = heading.toLowerCase();
  let result = stripMainSection(content, normalizedHeading);

  const lines = result.replace(/\r\n/g, "\n").split("\n");
  const docIdx = lines.findIndex((line) => stripBoldHeading(line) === "documentation gaps");
  const recIdx = lines.findIndex((line) => {
    const title = stripBoldHeading(line);
    return title === "recommended next step" || title === "recommended next steps";
  });
  const sectionLines = [heading, "", ...blocks.flatMap((block) => [block, ""])];

  let insertAt = recIdx >= 0 ? recIdx : lines.length;
  if (docIdx >= 0 && recIdx === -1) {
    insertAt = lines.length;
  }

  return [...lines.slice(0, insertAt), ...sectionLines, ...lines.slice(insertAt)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripStrayReviewSubsectionHeadings(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if (FORBIDDEN_SUBSECTION_HEADERS.has(stripBoldHeading(line.trim()))) {
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
}

function stripMainSection(content: string, sectionTitle: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!skipping && stripBoldHeading(trimmed) === sectionTitle) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (isMainSectionLine(trimmed)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeRecommendedNextStep(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inSection = false;
  let keptStep = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionTitle = stripBoldHeading(trimmed);

    if (sectionTitle === "recommended next steps" || sectionTitle === "recommended next step") {
      inSection = true;
      keptStep = false;
      out.push(RECOMMENDED_NEXT_STEP_HEADING);
      continue;
    }

    if (inSection && isMainSectionLine(trimmed) && sectionTitle !== "recommended next step") {
      inSection = false;
    }

    if (inSection && trimmed) {
      if (isMainSectionLine(trimmed) || /^\*\*[^*]+\*\*$/.test(trimmed)) {
        out.push(line);
        continue;
      }
      if (keptStep) {
        continue;
      }
      const stepBody = trimmed.replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, "");
      if (stepBody) {
        out.push(stepBody);
        keptStep = true;
      }
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

export function enrichKnowledgeGapsResponse(
  content: string,
  context?: KnowledgeGapsEnrichmentContext
): string {
  const documentationBlocks = documentationBlocksFromContext(context);
  const ownershipBlocks = ownershipBlocksFromContext(context);
  const integrationBlocks = integrationBlocksFromContext(context);

  let result = normalizeFieldLines(content);
  result = stripStrayReviewSubsectionHeadings(result);
  result = rebuildSummaryForZeroScanGaps(result, context);
  result = stripMainSection(result, "ownership & maintenance");
  result = stripMainSection(result, "integration & operations");
  result = rebuildDocumentationGapsSection(result, documentationBlocks);
  result = rebuildMainSection(result, "**Ownership & maintenance**", ownershipBlocks);
  result = rebuildMainSection(result, "**Integration & operations**", integrationBlocks);

  result = normalizeRecommendedNextStep(result);
  return enrichIntegrationDocsResponse(result, context);
}

/** Linkify attached Confluence/Notion/Google Docs titles and file paths in narrative responses. */
export function enrichIntegrationDocsResponse(
  content: string,
  context?: IntegrationDocsEnrichmentContext
): string {
  let result = content;
  if (context?.confluencePages?.length) {
    result = linkifyPageTitles(result, context.confluencePages);
  }
  if (context?.notionPages?.length) {
    result = linkifyPageTitles(result, context.notionPages);
  }
  if (context?.googleDocs?.length) {
    result = linkifyPageTitles(result, context.googleDocs);
  }
  result = linkifyFilePaths(result);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

type BundleEntry = { data?: Record<string, unknown> };

function readBundleEntries(bundle: unknown): BundleEntry[] {
  return Array.isArray(bundle) ? (bundle as BundleEntry[]) : [];
}

function mapIntegrationPages(
  pages: unknown[] | undefined,
  urlKey: "htmlUrl" | "url" = "htmlUrl"
): IntegrationPageForEnrichment[] | undefined {
  if (!Array.isArray(pages) || pages.length === 0) {
    return undefined;
  }

  const mapped = pages
    .map((page) => {
      if (!page || typeof page !== "object") {
        return undefined;
      }
      const record = page as { title?: string; excerpt?: string; htmlUrl?: string; url?: string };
      const title = record.title?.trim();
      if (!title) {
        return undefined;
      }
      const excerpt = record.excerpt?.trim();
      const htmlUrl = (record[urlKey] ?? record.htmlUrl ?? record.url)?.trim();
      return {
        title,
        ...(excerpt ? { excerpt } : {}),
        ...(htmlUrl ? { htmlUrl } : {})
      };
    })
    .filter((page): page is IntegrationPageForEnrichment => Boolean(page));

  return mapped.length > 0 ? mapped : undefined;
}

export function extractConfluencePagesFromBundle(
  bundle: unknown
): IntegrationPageForEnrichment[] | undefined {
  for (const entry of readBundleEntries(bundle)) {
    const search = entry.data?.confluenceSearch as { pages?: unknown[] } | undefined;
    const pages = mapIntegrationPages(search?.pages);
    if (pages) {
      return pages;
    }
  }
  return undefined;
}

export function extractNotionPagesFromBundle(bundle: unknown): IntegrationPageForEnrichment[] | undefined {
  for (const entry of readBundleEntries(bundle)) {
    const search = entry.data?.notionSearch as { pages?: unknown[] } | undefined;
    const pages = mapIntegrationPages(search?.pages, "url");
    if (pages) {
      return pages;
    }
  }
  return undefined;
}

export function extractGoogleDocsFromBundle(bundle: unknown): IntegrationPageForEnrichment[] | undefined {
  for (const entry of readBundleEntries(bundle)) {
    const search = entry.data?.googleDocsSearch as { documents?: unknown[] } | undefined;
    const pages = mapIntegrationPages(search?.documents, "url");
    if (pages) {
      return pages;
    }
  }
  return undefined;
}

export function extractJobScanGapsFromBundle(bundle: unknown): KnowledgeGapScanGap[] | undefined {
  for (const entry of readBundleEntries(bundle)) {
    const data = entry.data;
    const jobScan = data?.jobScan as { gaps?: KnowledgeGapScanGap[] } | undefined;
    if (Array.isArray(jobScan?.gaps) && jobScan.gaps.length > 0) {
      return jobScan.gaps;
    }
  }
  return undefined;
}
