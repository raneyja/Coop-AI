import { extractSourceCitationInner, normalizeSourceCitationLabel } from "./sourceCitationRegistry";

/** Markdown link parsed by ChatProse to jump to the evidence Sources card for this turn. */
export const VIEW_ALL_SOURCES_LINK = "[View all sources ↑](coop-evidence:)";

export const SOURCES_SECTION_HEADING = "**Sources**";
export const MAX_SOURCES_FOOTER_BULLETS = 3;

const SECTION_HEADING_RE = /^\*\*([^*]+)\*\*\s*$/;
const LIST_BULLET_RE = /^(\s*)[-*]\s+(.+)$/;

type ParsedSourceBullet = {
  raw: string;
  indent: string;
  label: string;
  body: string;
};

/** True when the response uses the Coop quick-action **Sources** footer section. */
export function hasSourcesFooterSection(content: string): boolean {
  return /\n\*\*Sources\*\*\s*\n/i.test(content) || content.trimStart().startsWith("**Sources**");
}

/**
 * Collapse per-page integration doc bullets, keep top priority sources, and append
 * a card jump link when more evidence exists in the Sources card than shown.
 */
export function enrichSourcesFooter(content: string): string {
  if (!hasSourcesFooterSection(content)) {
    return content;
  }

  const parsed = parseSourcesSection(content);
  if (!parsed || parsed.bullets.length === 0) {
    return content;
  }

  const grouped = groupIntegrationDocBullets(parsed.bullets);
  const normalizedBullets = grouped.map((bullet) => formatSourceBullet(bullet));
  const originalBullets = parsed.bullets.map((bullet) => bullet.raw);
  const groupingChanged = normalizedBullets.join("\n") !== originalBullets.join("\n");

  if (grouped.length <= MAX_SOURCES_FOOTER_BULLETS) {
    if (!groupingChanged) {
      return content;
    }
    return rebuildSourcesSection(parsed.before, normalizedBullets, parsed.after, false);
  }

  const prioritized = [...grouped]
    .sort((a, b) => sourceBulletPriority(a.label) - sourceBulletPriority(b.label))
    .slice(0, MAX_SOURCES_FOOTER_BULLETS);
  const keptBullets = prioritized.map((bullet) => formatSourceBullet(bullet));
  return rebuildSourcesSection(parsed.before, keptBullets, parsed.after, true);
}

function parseSourcesSection(content: string): {
  before: string;
  bullets: ParsedSourceBullet[];
  after: string;
} | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const headingPattern = /\n\*\*Sources\*\*\s*\n/i;
  const startMatch = headingPattern.exec(normalized);
  const startsWithHeading = /^\*\*Sources\*\*\s*\n/i.test(normalized.trimStart());

  let sectionStart: number;
  let headingLength: number;
  if (startMatch) {
    sectionStart = startMatch.index + 1;
    headingLength = startMatch[0].length - 1;
  } else if (startsWithHeading) {
    sectionStart = 0;
    const headingLine = normalized.split("\n")[0] ?? "";
    headingLength = headingLine.length + 1;
  } else {
    return null;
  }

  const bodyStart = sectionStart + headingLength;
  const lines = normalized.slice(bodyStart).split("\n");
  const bullets: ParsedSourceBullet[] = [];
  let consumed = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      if (bullets.length > 0) {
        consumed += line.length + 1;
        continue;
      }
      consumed += line.length + 1;
      continue;
    }

    const bulletMatch = line.match(LIST_BULLET_RE);
    if (bulletMatch) {
      const body = bulletMatch[2] ?? "";
      const label = extractLabelFromBulletBody(body);
      if (label) {
        bullets.push({
          raw: line,
          indent: bulletMatch[1] ?? "",
          label: normalizeSourceCitationLabel(label),
          body
        });
        consumed += line.length + 1;
        continue;
      }
    }

    if (SECTION_HEADING_RE.test(line.trim()) && bullets.length > 0) {
      break;
    }

    if (bullets.length === 0 && line.includes(VIEW_ALL_SOURCES_LINK)) {
      consumed += line.length + 1;
      continue;
    }

    break;
  }

  const before = normalized.slice(0, sectionStart);
  const after = normalized.slice(bodyStart + consumed);
  return { before, bullets, after };
}

function extractLabelFromBulletBody(body: string): string | undefined {
  const bracketMatch = body.match(/\[Sources:\s*.+?\]/i);
  if (bracketMatch) {
    return bracketMatch[0];
  }
  const codeMatch = body.match(/`(\[Sources:\s*.+?\])`/i);
  return codeMatch?.[1];
}

function groupIntegrationDocBullets(bullets: ParsedSourceBullet[]): ParsedSourceBullet[] {
  const result: ParsedSourceBullet[] = [];
  const confluence: ParsedSourceBullet[] = [];
  const notion: ParsedSourceBullet[] = [];
  const googleDocs: ParsedSourceBullet[] = [];

  for (const bullet of bullets) {
    const kind = integrationDocBulletKind(bullet.label);
    switch (kind) {
      case "confluence":
        confluence.push(bullet);
        break;
      case "notion":
        notion.push(bullet);
        break;
      case "google-docs":
        googleDocs.push(bullet);
        break;
      default:
        result.push(bullet);
        break;
    }
  }

  pushGroupedDocBullets(result, confluence, "Confluence");
  pushGroupedDocBullets(result, notion, "Notion");
  pushGroupedDocBullets(result, googleDocs, "Google Docs");
  return result;
}

type IntegrationDocKind = "confluence" | "notion" | "google-docs";

function integrationDocBulletKind(label: string): IntegrationDocKind | undefined {
  const inner = extractSourceCitationInner(label).toLowerCase();
  if (/^confluence pages(\s|\(|$)/.test(inner) || inner === "confluence architecture" || inner === "confluence search") {
    return undefined;
  }
  if (/^notion pages(\s|\(|$)/.test(inner) || inner === "notion search") {
    return undefined;
  }
  if (/^google docs(\s|\(|$)/.test(inner) && inner.includes("(")) {
    return undefined;
  }
  if (inner === "google docs" || inner === "google docs search") {
    return undefined;
  }
  if (inner.startsWith("confluence ")) {
    return "confluence";
  }
  if (inner.startsWith("notion ")) {
    return "notion";
  }
  if (inner.startsWith("google docs ")) {
    return "google-docs";
  }
  return undefined;
}

function pushGroupedDocBullets(
  result: ParsedSourceBullet[],
  bullets: ParsedSourceBullet[],
  provider: "Confluence" | "Notion" | "Google Docs"
): void {
  if (bullets.length === 0) {
    return;
  }
  if (bullets.length === 1) {
    result.push(bullets[0]!);
    return;
  }
  const label = groupedIntegrationDocLabel(provider, bullets.length);
  const summary = mergeGroupedDescriptions(bullets, `${provider} documentation reviewed in search results.`);
  result.push({
    raw: "",
    indent: bullets[0]!.indent,
    label,
    body: `${label} — ${summary}`
  });
}

export function groupedIntegrationDocLabel(provider: "Confluence" | "Notion" | "Google Docs", count: number): string {
  const noun =
    provider === "Confluence"
      ? "Confluence pages"
      : provider === "Notion"
        ? "Notion pages"
        : "Google Docs";
  return normalizeSourceCitationLabel(`${noun} (${count} reviewed)`);
}

function mergeGroupedDescriptions(bullets: ParsedSourceBullet[], fallback: string): string {
  const parts = bullets
    .map((bullet) => bulletDescription(bullet.body))
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return fallback;
  }
  const unique = [...new Set(parts)];
  if (unique.length === 1) {
    return unique[0]!;
  }
  return fallback;
}

function bulletDescription(body: string): string {
  const dash = body.indexOf("—");
  if (dash >= 0) {
    return body.slice(dash + 1).trim();
  }
  const hyphen = body.indexOf(" - ");
  if (hyphen >= 0) {
    return body.slice(hyphen + 3).trim();
  }
  return "";
}

function formatSourceBullet(bullet: ParsedSourceBullet): string {
  if (bullet.raw && bullet.raw.trim()) {
    return bullet.raw;
  }
  return `${bullet.indent}- ${bullet.body}`;
}

function rebuildSourcesSection(
  before: string,
  bullets: string[],
  after: string,
  includeViewAll: boolean
): string {
  const lines = [SOURCES_SECTION_HEADING, ...bullets];
  if (includeViewAll) {
    lines.push(VIEW_ALL_SOURCES_LINK);
  }
  const section = lines.join("\n");
  const trimmedAfter = after.replace(/^\n+/, "");
  if (!trimmedAfter) {
    return `${before}${section}\n`.trimEnd();
  }
  return `${before}${section}\n\n${trimmedAfter}`.trimEnd();
}

/** Lower rank = higher priority in the capped Sources footer. */
export function sourceBulletPriority(label: string): number {
  const inner = extractSourceCitationInner(label).toLowerCase();
  if (inner.startsWith("github commit")) {
    return 0;
  }
  if (inner.startsWith("pr #")) {
    return 1;
  }
  if (inner.startsWith("jira")) {
    return 2;
  }
  if (inner.startsWith("slack")) {
    return 3;
  }
  if (inner.startsWith("teams")) {
    return 4;
  }
  if (inner.includes("ownership") || inner.includes("codeowners")) {
    return 8;
  }
  if (inner.includes("dependency") || inner.includes("knowledge gap scan")) {
    return 9;
  }
  if (inner.includes("repository manifest") || inner.includes("anchor files")) {
    return 10;
  }
  if (inner.includes("test files") || inner.includes("public api") || inner.includes("recent changes")) {
    return 11;
  }
  if (inner.includes("confluence")) {
    return 20;
  }
  if (inner.includes("notion")) {
    return 21;
  }
  if (inner.includes("google docs")) {
    return 22;
  }
  if (inner.includes("evidence limited")) {
    return 30;
  }
  return 15;
}
