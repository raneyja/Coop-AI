/**
 * L-only finish trim. The last-line local-file directive is not enough — models
 * still emit review checklists and “If you want I can” offers. Do not call this
 * on indexed-repo, intent-job, or slash answers.
 */

const OFFER_TO_CONTINUE =
  /\bIf you want(?:ed)?,?\s+I can\b/i;

const HONEST_LIMIT =
  "Other files were not read, so callers and implementations of imported types are unknown.";

/** Canonical line, or the model's paraphrase of the same limit. */
const HONEST_LIMIT_PARAPHRASE =
  /\b(?:other files were not (?:read|searched|attached)|only read this (?:local )?file|callers and implementations of imported types)\b/i;

function isTopicHeading(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return true;
  }
  return /^\*\*[^*]+\*\*\s*$/.test(trimmed);
}

function paragraphStatesHonestLimit(paragraph: string): boolean {
  const text = paragraph.replace(/\s+/g, " ").trim();
  if (!text || text.length > 320) {
    return false;
  }
  return HONEST_LIMIT_PARAPHRASE.test(text);
}

/**
 * One limit sentence. If the model already said it, and we would add the
 * canonical line, keep a single paragraph — the canonical wording when present.
 */
function collapseHonestLimit(text: string): string {
  const parts = text.split(/\n\n+/).filter((part) => part.trim());
  const limitIndexes = parts
    .map((part, index) => (paragraphStatesHonestLimit(part) ? index : -1))
    .filter((index) => index >= 0);
  if (limitIndexes.length === 0) {
    return `${text}\n\n${HONEST_LIMIT}`;
  }
  if (limitIndexes.length === 1) {
    return dropParaphraseWhenCanonicalPresent(parts.join("\n\n"));
  }
  const keep =
    limitIndexes.find((index) =>
      /\bother files were not (?:read|searched|attached)\b/i.test(parts[index] ?? "")
    ) ?? limitIndexes[0]!;
  return dropParaphraseWhenCanonicalPresent(
    parts.filter((part, index) => !paragraphStatesHonestLimit(part) || index === keep).join("\n\n")
  );
}

/** Same paragraph can hold the model's wording and the canonical sentence. Keep one. */
function dropParaphraseWhenCanonicalPresent(text: string): string {
  if (!/\bother files were not (?:read|searched|attached)\b/i.test(text)) {
    return text;
  }
  return text
    .replace(/[^.!?\n]*\bonly read this (?:local )?file\b[^.!?\n]*[.!?]?\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Keep the opening answer. Drop extra headings, search checklists, and offers.
 * Append the honest-limit sentence when it is missing. Never leave two.
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
  return collapseHonestLimit(text);
}
