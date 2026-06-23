export type ConfluencePageForEnrichment = {
  title: string;
  excerpt?: string;
  htmlUrl?: string;
};

export type KnowledgeGapsEnrichmentContext = {
  confluencePages?: ConfluencePageForEnrichment[];
  activeFile?: string;
};

const CONFLUENCE_REVIEWED_HEADING = "**Confluence pages reviewed**";

const FORBIDDEN_SUBSECTION_HEADERS = new Set([
  "documentation coverage",
  "confluence pages reviewed"
]);

const PROMOTED_MAIN_SECTIONS: Record<string, string> = {
  ownership: "**Ownership & maintenance**",
  "ownership clarity": "**Ownership & maintenance**",
  "operational unknowns": "**Integration & operations**"
};

const FIELD_LINE_RE = /^(?:[-*]\s+)?(?:\*\*)?(Open question|What to check)(?:\*\*)?:\s*(.*)$/gim;

const FILE_PATH_RE =
  /\b((?:src|docs)\/[\w./-]+|[A-Za-z][\w.-]*\.(?:ts|tsx|js|jsx|py|md|json|yml|yaml))\b/g;

function normalizeFieldLines(content: string): string {
  return content.replace(FIELD_LINE_RE, (_, label, body) => {
    const normalized = label.toLowerCase() === "what to check" ? "What to check" : "Open question";
    const cleaned = body.replace(/^\*\*\s*/, "").trim();
    return cleaned ? `- **${normalized}:** ${cleaned}` : `- **${normalized}:**`;
  });
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
    title === "recommended next steps" ||
    title === "open questions" ||
    title === "key unknowns"
  );
}

function isConfluenceReviewedHeading(line: string): boolean {
  const match = line.trim().match(/^\*\*([^*]+)\*\*$/);
  return Boolean(match && match[1].trim().toLowerCase() === "confluence pages reviewed");
}

function isPromotableOwnershipOrOpsHeading(line: string): string | undefined {
  const match = line.trim().match(/^\*\*([^*]+)\*\*$/);
  if (!match) {
    return undefined;
  }
  return PROMOTED_MAIN_SECTIONS[match[1].trim().toLowerCase()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMainSectionHeading(line: string): string {
  const trimmed = line.trim();
  const bold = trimmed.match(/^\*\*([^*]+)\*\*$/);
  if (bold) {
    return trimmed;
  }
  return `**${trimmed}**`;
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
  if (/\b(policy|compliance|security|audit)\b/.test(haystack)) {
    return "Policy or compliance documentation; relevant for change approval gates.";
  }
  if (/\b(onboarding|getting started|developer guide)\b/.test(haystack)) {
    return "Developer onboarding or setup documentation.";
  }
  if (/\b(integration|oauth|connect)\b/.test(haystack)) {
    return "Integration setup documentation; check env and OAuth configuration.";
  }
  if (/\b(deploy|deployment|ci\/cd|pipeline|release)\b/.test(haystack)) {
    return "Deployment or CI/CD documentation; relevant for rollout verification.";
  }
  if (/\b(architecture|overview|system design)\b/.test(haystack)) {
    return `Architecture overview; useful system context around ${fileRef}.`;
  }
  return activeFile
    ? `Repo-linked page; title does not mention ${fileRef} directly.`
    : "Repo-linked Confluence page; relevance to the active file is unclear.";
}

function confluencePageNote(page: ConfluencePageForEnrichment, activeFile?: string): string {
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

function formatConfluenceListLine(page: ConfluencePageForEnrichment, activeFile?: string): string {
  const note = linkifyFilePaths(confluencePageNote(page, activeFile));
  if (page.htmlUrl) {
    return `- [${page.title}](${page.htmlUrl}) — ${note}`;
  }
  return `- **${page.title}:** ${note}`;
}

export function buildConfluencePagesReviewedBlock(
  pages: ConfluencePageForEnrichment[],
  activeFile?: string
): string {
  const lines = [CONFLUENCE_REVIEWED_HEADING, ""];
  for (const page of pages) {
    lines.push(formatConfluenceListLine(page, activeFile));
  }
  return lines.join("\n");
}

function stripConfluencePagesSection(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!skipping && isConfluenceReviewedHeading(trimmed)) {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (isMainSectionLine(trimmed)) {
        skipping = false;
        out.push(lines[i]);
      }
      continue;
    }

    if (FORBIDDEN_SUBSECTION_HEADERS.has(stripBoldHeading(trimmed))) {
      continue;
    }

    out.push(lines[i]);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripBoldHeading(line: string): string {
  const match = line.trim().match(/^\*\*([^*]+)\*\*$/);
  return match ? match[1].trim().toLowerCase() : line.trim().toLowerCase();
}

function insertConfluenceAfterDocumentationGaps(content: string, block: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const docGapsIdx = lines.findIndex((line) => stripBoldHeading(line) === "documentation gaps");
  if (docGapsIdx === -1) {
    return `${content}\n\n**Documentation gaps**\n\n${block}`;
  }

  let insertAt = docGapsIdx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") {
    insertAt += 1;
  }

  const alreadyPresent = lines
    .slice(docGapsIdx, Math.min(docGapsIdx + 24, lines.length))
    .some((line) => isConfluenceReviewedHeading(line.trim()));
  if (alreadyPresent) {
    return replaceConfluenceBlockInDocumentationGaps(lines, docGapsIdx, block);
  }

  const next = [...lines.slice(0, insertAt), "", block, "", ...lines.slice(insertAt)];
  return next.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function replaceConfluenceBlockInDocumentationGaps(
  lines: string[],
  docGapsIdx: number,
  block: string
): string {
  const out = [...lines];
  const start = out.findIndex((line, index) => index > docGapsIdx && isConfluenceReviewedHeading(line.trim()));
  if (start === -1) {
    return out.join("\n");
  }

  let end = start + 1;
  while (end < out.length) {
    const trimmed = out[end].trim();
    if (trimmed === "") {
      end += 1;
      continue;
    }
    if (isMainSectionLine(trimmed) || isPromotableOwnershipOrOpsHeading(trimmed)) {
      break;
    }
    if (
      trimmed.match(/^\*\*[^*]+\*\*$/) &&
      !trimmed.match(/^- /) &&
      stripBoldHeading(trimmed) !== "confluence pages reviewed"
    ) {
      break;
    }
    end += 1;
  }

  out.splice(start, end - start, ...block.split("\n"), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function promoteOwnershipAndOpsSections(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const promoted = isPromotableOwnershipOrOpsHeading(lines[i]);
    if (promoted) {
      if (out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      out.push(promoted);
      out.push("");
      continue;
    }
    out.push(lines[i]);
  }

  return out.join("\n");
}

function normalizeRecommendedNextSteps(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inSection = false;
  let stepNumber = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (stripBoldHeading(trimmed) === "recommended next steps") {
      inSection = true;
      stepNumber = 0;
      out.push(toMainSectionHeading(trimmed));
      continue;
    }

    if (inSection && isMainSectionLine(trimmed) && stripBoldHeading(trimmed) !== "recommended next steps") {
      inSection = false;
    }

    if (inSection && trimmed) {
      if (/^\d+\.\s+/.test(trimmed)) {
        stepNumber += 1;
        out.push(line);
        continue;
      }
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        stepNumber += 1;
        out.push(`${stepNumber}. ${trimmed.replace(/^[-*]\s+/, "")}`);
        continue;
      }
      if (!isMainSectionLine(trimmed) && !/^\*\*[^*]+\*\*$/.test(trimmed)) {
        stepNumber += 1;
        out.push(`${stepNumber}. ${trimmed}`);
        continue;
      }
    }

    out.push(line);
  }

  return out.join("\n");
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

function linkifyConfluenceTitles(text: string, pages: ConfluencePageForEnrichment[]): string {
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

export function enrichKnowledgeGapsResponse(
  content: string,
  context?: KnowledgeGapsEnrichmentContext
): string {
  const confluencePages = context?.confluencePages;
  const activeFile = context?.activeFile;

  let result = normalizeFieldLines(content);
  result = promoteOwnershipAndOpsSections(result);
  result = stripConfluencePagesSection(result);

  if (confluencePages && confluencePages.length > 0) {
    result = linkifyConfluenceTitles(result, confluencePages);
    const block = buildConfluencePagesReviewedBlock(confluencePages, activeFile);
    result = insertConfluenceAfterDocumentationGaps(result, block);
  }

  result = normalizeRecommendedNextSteps(result);
  result = linkifyFilePaths(result);

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractConfluencePagesFromBundle(
  bundle: unknown
): ConfluencePageForEnrichment[] | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }

  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const data = (entry as { data?: { confluenceSearch?: { pages?: unknown[] } } }).data;
    const pages = data?.confluenceSearch?.pages;
    if (!Array.isArray(pages) || pages.length === 0) {
      continue;
    }

    const mapped = pages
      .map((page) => {
        if (!page || typeof page !== "object") {
          return undefined;
        }
        const title = (page as { title?: string }).title?.trim();
        if (!title) {
          return undefined;
        }
        const excerpt = (page as { excerpt?: string }).excerpt?.trim();
        const htmlUrl = (page as { htmlUrl?: string }).htmlUrl?.trim();
        return {
          title,
          ...(excerpt ? { excerpt } : {}),
          ...(htmlUrl ? { htmlUrl } : {})
        };
      })
      .filter((page): page is ConfluencePageForEnrichment => Boolean(page));

    return mapped.length > 0 ? mapped : undefined;
  }

  return undefined;
}
