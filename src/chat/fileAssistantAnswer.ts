import { isLocalFileChangeAsk } from "./editAskKind";

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

/** Invented hunt / review language that must not survive an L finish gate. */
const HUNT_OR_REVIEW_PHRASE =
  /\b(?:check every consumer|search the codebase|update all call sites|update callers, serializers, docs, and tests|serialized contracts that depend|JsonPropertyName|NuGet|release notes|Quick checklist|Concrete spot to review|Technical checks|Security & operational|Tests & integration|Where to look next)\b/i;

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

/** Remove hunt clauses; keep in-file facts in the same sentence when present. */
function scrubHuntClauses(text: string): string {
  return text
    .replace(/\bcheck every consumer(?: and[^—.!?]*)?/gi, "")
    .replace(/\bany serialized contracts that depend[^—.!?]*/gi, "")
    .replace(/\brenaming a property is a breaking change\.?/gi, "")
    .replace(/\band treat it as a public API change:\s*/gi, "")
    .replace(/\bupdate callers, serializers, docs, and tests\.?/gi, "")
    .replace(/\bupdate all call sites\.?/gi, "")
    .replace(/\bsearch the codebase[^.!?]*/gi, "")
    .replace(/\bJsonPropertyName\b[^.!?]*/gi, "")
    .replace(/\bNuGet\b[^.!?]*/gi, "")
    .replace(/\brelease notes\b[^.!?]*/gi, "")
    .replace(/[—–-]\s*(?=[.!]|$)/g, "")
    .replace(/\s*,\s*,/g, ",")
    .replace(/,\s*([A-Z])/g, ". $1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/^[,;:\s]+/g, "")
    .trim();
}

/**
 * Drop hunt/review language from the lead. Keep in-file facts (typos, type names).
 * If nothing remains, fall back to the honest-limit only.
 */
function stripHuntLeadLanguage(text: string): string {
  // Citation fences are evidence, not prose. Scrubbing whitespace in them
  // collapsed the locator and source into a single line, destroying the IDE
  // citation card even though the correct file body reached the model.
  const blocks = text.split(/(^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$)/m);
  if (blocks.length > 1) {
    return blocks.map((block, index) => index % 2 === 1 ? block :
      block.trim() ? stripHuntLeadLanguage(block) : "").filter(Boolean).join("\n\n");
  }
  const paragraphs = text.split(/\n\n+/).filter((part) => part.trim());
  if (paragraphs.length === 0) {
    return text;
  }
  const cleaned: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraphStatesHonestLimit(paragraph)) {
      cleaned.push(paragraph);
      continue;
    }
    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const kept: string[] = [];
    for (const sentence of sentences) {
      const scrubbed = scrubHuntClauses(sentence);
      if (!scrubbed || scrubbed.length < 12) {
        continue;
      }
      if (HUNT_OR_REVIEW_PHRASE.test(scrubbed)) {
        continue;
      }
      kept.push(scrubbed);
    }
    if (kept.length > 0) {
      cleaned.push(kept.join(" "));
    }
  }
  const joined = cleaned.join("\n\n").trim();
  return joined || HONEST_LIMIT;
}

/**
 * Prose before the first SEARCH block. The File: line and opening fence stay
 * with the patch so Apply can still build a card.
 */
function detachPatchTail(text: string): { prose: string; patch: string } {
  const searchAt = text.search(/<<<<<<< SEARCH/);
  if (searchAt < 0) {
    return { prose: text, patch: "" };
  }
  let start = searchAt;
  const before = text.slice(0, searchAt);
  const fenceAt = before.lastIndexOf("```");
  if (fenceAt >= 0 && searchAt - fenceAt < 160) {
    start = fenceAt;
  }
  const head = text.slice(0, start);
  const fileHeader = head.match(/(?:^|\n)([ \t]*\*{0,2}File:[^\n]*\s*)$/);
  if (fileHeader?.index !== undefined) {
    const offset = fileHeader[0].startsWith("\n") ? 1 : 0;
    start = fileHeader.index + offset;
  }
  return {
    prose: text.slice(0, start).trim(),
    patch: text.slice(start).trim()
  };
}

/**
 * A change ask is one sentence of prose. The patch block stays so the card
 * can render. Drop the file tour and the honest-limit line.
 */
function editLeadOnly(text: string): string {
  const { prose, patch } = detachPatchTail(text);
  const withoutLimit = prose
    .replace(/\n+\s*Other files were not read[\s\S]*$/i, "")
    .replace(/\n+\s*I only read this (?:local )?file\b[\s\S]*$/i, "")
    .trim();
  const first = withoutLimit.split(/\n\n+/)[0]?.trim() ?? "";
  const lead = first.split(/\n/)[0]?.trim() ?? "";
  if (!patch) {
    return lead || withoutLimit;
  }
  if (!lead) {
    return patch;
  }
  return `${lead}\n\n${patch}`;
}

/**
 * Keep the opening answer. Drop extra headings, search checklists, and offers.
 * Strip invented hunt/review lead phrases. Append the honest-limit when missing.
 * A local-file edit keeps the first sentence only.
 */
export function enrichFileAssistantResponse(
  content: string,
  options?: { userQuestion?: string }
): string {
  const raw = content.trim();
  if (!raw) {
    return content;
  }

  const kept: string[] = [];
  let inFence = false;
  for (const line of raw.split("\n")) {
    if (/^[ \t]*```/.test(line)) inFence = !inFence;
    if (!inFence && (isTopicHeading(line) || OFFER_TO_CONTINUE.test(line))) {
      break;
    }
    kept.push(line);
  }

  let text = kept.join("\n").trim();
  if (!text) {
    return raw;
  }
  if (isLocalFileChangeAsk(options?.userQuestion)) {
    return editLeadOnly(text);
  }
  text = stripHuntLeadLanguage(text);
  return collapseHonestLimit(text);
}
