/**
 * L-only finish trim. The last-line local-file directive is not enough — models
 * still emit review checklists and “If you want I can” offers. Do not call this
 * on indexed-repo, intent-job, or slash answers.
 */

const OFFER_TO_CONTINUE =
  /\bIf you want(?:ed)?,?\s+I can\b/i;

const HONEST_LIMIT =
  "Other files were not read, so callers and implementations of imported types are unknown.";

const HAS_HONEST_LIMIT =
  /\bother files were not (?:read|searched|attached)\b/i;

function isTopicHeading(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return true;
  }
  return /^\*\*[^*]+\*\*\s*$/.test(trimmed);
}

/**
 * Keep the opening answer. Drop extra headings, search checklists, and offers.
 * Append the honest-limit sentence when it is missing.
 */
export function enrichFileAssistantResponse(content: string): string {
  const raw = content.trim();
  if (!raw) {
    return content;
  }

  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    if (isTopicHeading(line) || OFFER_TO_CONTINUE.test(line)) {
      break;
    }
    kept.push(line);
  }

  let text = kept.join("\n").trim();
  const offerAt = text.search(OFFER_TO_CONTINUE);
  if (offerAt >= 0) {
    text = text.slice(0, offerAt).trim();
  }
  if (!text) {
    return raw;
  }
  if (!HAS_HONEST_LIMIT.test(text)) {
    text = `${text}\n\n${HONEST_LIMIT}`;
  }
  return text;
}
