/**
 * Post-process Find Owner answers so padded essay sections never ship,
 * even when the model ignores omit-unless-evidenced instructions.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionPattern(heading: string): RegExp {
  return new RegExp(
    `(^|\\n)\\*\\*${escapeRegExp(heading)}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*]|$)`,
    "i"
  );
}

function extractSectionBody(content: string, heading: string): string | undefined {
  const match = sectionPattern(heading).exec(content);
  return match?.[2]?.trim();
}

function stripSection(content: string, heading: string): string {
  return content.replace(sectionPattern(heading), "$1").replace(/\n{3,}/g, "\n\n").trim();
}

const LOW_SIGNAL_BODY =
  /^(unknown|n\/a|none|none identified|none flagged|not available|not actionable|no (significant |notable )?(risks?|issues?|concerns?)|availability unknown|no knowledge transfer|not evidenced|omit|—|-)\.?$/i;

function isLowSignalBody(body: string | undefined): boolean {
  if (!body?.trim()) {
    return true;
  }
  const compact = body
    .replace(/[*_`#>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length < 8) {
    return true;
  }
  if (LOW_SIGNAL_BODY.test(compact)) {
    return true;
  }
  if (/^(there (is|are) no|no clear|nothing (notable|significant)|not enough evidence)/i.test(compact)) {
    return true;
  }
  return false;
}

function availabilityIsHighSignal(body: string | undefined): boolean {
  if (isLowSignalBody(body)) {
    return false;
  }
  const text = body!;
  return (
    /\b(active|away|dnd|offline|online|in (a )?meeting|ooo|out of office|timezone|slack|reachable|response time)\b/i.test(
      text
    ) && !/\b(unknown|unavailable in evidence|not connected)\b/i.test(text)
  );
}

function risksAreHighSignal(body: string | undefined): boolean {
  if (isLowSignalBody(body)) {
    return false;
  }
  return /\b(spof|single[- ]point|bus factor|orphaned|stale|inactive|only one|no backup|dispersion|turnover)\b/i.test(
    body!
  );
}

function knowledgeTransferIsHighSignal(body: string | undefined): boolean {
  if (isLowSignalBody(body)) {
    return false;
  }
  return /(@[a-zA-Z0-9-]+|[A-Z][a-z]+ [A-Z][a-z]+|\bpair(ing)?\b|\bsecondary\b|\bbackup\b|\bshadow\b)/.test(
    body!
  );
}

const ALWAYS_STRIP_HEADINGS = [
  "Recommended next step",
  "Recommended next steps",
  "Next steps",
  "Suggested outreach"
];

const OPTIONAL_HEADINGS = ["Availability", "Risks", "Knowledge transfer"] as const;

/**
 * Enforce contact-first Find Owner shape: drop essay padding and empty optional sections.
 */
export function enrichFindOwnerResponse(content: string): string {
  let result = content.trim();
  if (!result) {
    return result;
  }

  for (const heading of ALWAYS_STRIP_HEADINGS) {
    result = stripSection(result, heading);
  }

  for (const heading of OPTIONAL_HEADINGS) {
    const body = extractSectionBody(result, heading);
    if (body === undefined) {
      continue;
    }
    const keep =
      heading === "Availability"
        ? availabilityIsHighSignal(body)
        : heading === "Risks"
          ? risksAreHighSignal(body)
          : knowledgeTransferIsHighSignal(body);
    if (!keep) {
      result = stripSection(result, heading);
    }
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}
