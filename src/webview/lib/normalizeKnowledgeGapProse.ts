import { COOP_MAIN_SECTIONS, isCoopMainSection } from "./coopChatSections";

const KG_FIELD_LABEL_PATTERN = "(?:Open question|What to check|Evidence [Nn]eeded|Unknown|Question)";

const KG_FIELD_LINE_RE = new RegExp(
  `^(?:[-*]\\s+)?(?:\\*\\*)?(${KG_FIELD_LABEL_PATTERN})(?:\\*\\*)?:\\s*(.*)$`,
  "i"
);

const KG_FIELD_ANY_RE = new RegExp(`\\b${KG_FIELD_LABEL_PATTERN}:`, "gi");

const BOLD_ONLY_LINE_RE = /^\*\*([^*]+)\*\*\s*$/;
const LIST_MARKER_RE = /^[-*]\s+/;
const PEEK_AHEAD_LINES = 8;

/** @deprecated Use COOP_MAIN_SECTIONS — kept for existing imports/tests. */
export const KG_MAIN_SECTIONS = COOP_MAIN_SECTIONS;

export const KG_FIELD_LABELS = new Set([
  "open question",
  "what to check",
  "unknown",
  "evidence needed",
  "question"
]);

export function normalizeKgFieldLabel(label: string): "Open question" | "What to check" {
  const lower = label.toLowerCase().replace(/:\s*$/, "").trim();
  if (lower === "what to check" || lower === "evidence needed") {
    return "What to check";
  }
  return "Open question";
}

export function isKgFieldLabelText(text: string): boolean {
  return KG_FIELD_LABELS.has(text.toLowerCase().replace(/:\s*$/, "").trim());
}

function countKgFieldLabels(content: string): number {
  return [...content.matchAll(KG_FIELD_ANY_RE)].length;
}

function hasGroupedCategoryPattern(content: string): boolean {
  const plainCategoryThenField = content.match(
    /^(?![-*#\s`|])(?!Open question:|What to check:|Unknown:|Evidence\s+[Nn]eeded:|Question:).+\n(?:[^\n]+\n){0,6}\s*(?:[-*]\s+)?(?:\*\*)?(?:Open question|What to check|Unknown|Evidence\s+[Nn]eeded|Question)/gim
  );
  return Boolean(plainCategoryThenField?.length);
}

export function shouldNormalizeCoopChatProse(content: string): boolean {
  if (countKgFieldLabels(content) >= 2 || hasGroupedCategoryPattern(content)) {
    return true;
  }
  if (/^[-*]\s+\*\*[^*]+\*\*\s*$/m.test(content)) {
    return true;
  }
  if (/^(?:Open question|What to check|Question|Evidence [Nn]eeded):/im.test(content)) {
    return true;
  }
  return false;
}

/** @deprecated Use shouldNormalizeCoopChatProse */
export function shouldNormalizeKnowledgeGapProse(content: string): boolean {
  return shouldNormalizeCoopChatProse(content);
}

function peekFieldLine(lines: string[], index: number): boolean {
  for (let j = index + 1; j < Math.min(index + PEEK_AHEAD_LINES, lines.length); j++) {
    const trimmed = lines[j]?.trim() ?? "";
    if (trimmed === "") {
      continue;
    }
    if (KG_FIELD_LINE_RE.test(trimmed)) {
      return true;
    }
    if (isCoopMainSection(stripCategoryTitle(trimmed))) {
      return false;
    }
    if (isCategoryTitleLine(trimmed, lines, j)) {
      return false;
    }
  }
  return false;
}

function formatFieldLine(label: string, body: string): string {
  const normalized = normalizeKgFieldLabel(label);
  const cleaned = body.replace(/^\*\*\s*/, "").trim();
  return cleaned ? `- **${normalized}:** ${cleaned}` : `- **${normalized}:**`;
}

function stripCategoryTitle(raw: string): string {
  const trimmed = raw.trim();
  const bold = trimmed.match(BOLD_ONLY_LINE_RE);
  if (bold) {
    return bold[1].trim();
  }
  const withoutMarker = trimmed.replace(LIST_MARKER_RE, "").trim();
  const innerBold = withoutMarker.match(BOLD_ONLY_LINE_RE);
  if (innerBold) {
    return innerBold[1].trim();
  }
  return withoutMarker;
}

function toCategoryHeading(raw: string): string {
  return `**${stripCategoryTitle(raw)}**`;
}

function toMainSectionHeading(raw: string): string {
  const title = stripCategoryTitle(raw);
  return `**${title}**`;
}

function isCategoryTitleLine(line: string, lines: string[], index: number): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("#")) {
    return false;
  }
  if (KG_FIELD_LINE_RE.test(trimmed)) {
    return false;
  }

  const title = stripCategoryTitle(trimmed);
  if (isKgFieldLabelText(title) || isCoopMainSection(title)) {
    return false;
  }
  if (title.endsWith("?") || title.length > 80) {
    return false;
  }
  if (LIST_MARKER_RE.test(trimmed) && KG_FIELD_LINE_RE.test(trimmed.replace(LIST_MARKER_RE, "").trim())) {
    return false;
  }

  return peekFieldLine(lines, index);
}

function isCategoryListItem(line: string, lines: string[], index: number): boolean {
  const trimmed = line.trim();
  if (!LIST_MARKER_RE.test(trimmed)) {
    return false;
  }
  const body = trimmed.replace(LIST_MARKER_RE, "").trim();
  if (KG_FIELD_LINE_RE.test(body)) {
    return false;
  }
  return isCategoryTitleLine(body, lines, index);
}

function absorbCategoryBody(lines: string[], startIndex: number): { lines: string[]; nextIndex: number } {
  const out: string[] = [];
  let i = startIndex + 1;
  const proseBuffer: string[] = [];

  const flushProse = () => {
    if (proseBuffer.length === 0) {
      return;
    }
    out.push(`- **Open question:** ${proseBuffer.join(" ")}`);
    proseBuffer.length = 0;
  };

  while (i < lines.length) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed === "") {
      if (proseBuffer.length > 0 && i + 1 < lines.length) {
        const next = lines[i + 1]?.trim() ?? "";
        if (next && !KG_FIELD_LINE_RE.test(next) && !isCategoryTitleLine(next, lines, i + 1)) {
          i += 1;
          continue;
        }
      }
      break;
    }

    if (isCategoryTitleLine(trimmed, lines, i) || isCategoryListItem(lines[i] ?? "", lines, i)) {
      break;
    }

    const title = stripCategoryTitle(trimmed);
    if (isCoopMainSection(title)) {
      break;
    }

    const fieldMatch = trimmed.match(KG_FIELD_LINE_RE);
    if (fieldMatch) {
      flushProse();
      out.push(formatFieldLine(fieldMatch[1], fieldMatch[2] ?? ""));
      i += 1;
      continue;
    }

    proseBuffer.push(trimmed);
    i += 1;
  }

  flushProse();
  return { lines: out, nextIndex: i };
}

function remapAnswerToSummary(content: string): string {
  return content
    .replace(/^\*\*Answer\*\*\s*$/gm, "**Summary**")
    .replace(/^Answer\s*$/gm, "**Summary**");
}

function outputHasDocumentationGapsSection(out: string[]): boolean {
  return out.some((line) => line.trim().toLowerCase() === "**documentation gaps**");
}

function shouldWrapWithDocumentationGaps(out: string[]): boolean {
  return (
    out.some((line) => line.trim() === "**Summary**") &&
    !outputHasDocumentationGapsSection(out) &&
    !out.some((line) => {
      const lower = line.trim().toLowerCase();
      return lower === "**open questions**" || lower.startsWith("**key unknowns");
    })
  );
}

function ensureDocumentationGapsHeader(out: string[], pushBlankBetweenGroups: () => void): void {
  if (!shouldWrapWithDocumentationGaps(out)) {
    return;
  }
  pushBlankBetweenGroups();
  out.push("**Documentation gaps**");
  out.push("");
}

function promotePlainMainSections(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !BOLD_ONLY_LINE_RE.test(trimmed) && isCoopMainSection(trimmed)) {
      out.push(toMainSectionHeading(trimmed));
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
}

export function normalizeCoopChatProse(content: string): string {
  const promoted = remapAnswerToSummary(promotePlainMainSections(content));
  if (!shouldNormalizeCoopChatProse(promoted)) {
    return promoted;
  }

  const lines = promoted.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  const pushBlankBetweenGroups = () => {
    if (out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      out.push("");
      continue;
    }

    const fieldMatch = trimmed.match(KG_FIELD_LINE_RE);
    if (fieldMatch) {
      out.push(formatFieldLine(fieldMatch[1], fieldMatch[2] ?? ""));
      continue;
    }

    const boldOnly = trimmed.match(BOLD_ONLY_LINE_RE);
    if (boldOnly && isCoopMainSection(boldOnly[1])) {
      pushBlankBetweenGroups();
      out.push(trimmed);
      continue;
    }

    if (isCategoryListItem(line, lines, i) || isCategoryTitleLine(line, lines, i)) {
      const title = stripCategoryTitle(trimmed);
      if (shouldWrapWithDocumentationGaps(out) && !isCoopMainSection(title)) {
        ensureDocumentationGapsHeader(out, pushBlankBetweenGroups);
      }
      pushBlankBetweenGroups();
      out.push(toCategoryHeading(trimmed));
      out.push("");
      const absorbed = absorbCategoryBody(lines, i);
      out.push(...absorbed.lines);
      i = absorbed.nextIndex - 1;
      continue;
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** @deprecated Use normalizeCoopChatProse */
export function normalizeKnowledgeGapProse(content: string): string {
  return normalizeCoopChatProse(content);
}
