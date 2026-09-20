/**
 * Finish-reason length / empty-heading recovery for chat answers.
 * AbortSignal stays user Stop only — this never aborts a stream.
 */

export const LENGTH_CONTINUE_PROMPT =
  "Continue the answer from where you stopped. Fill every heading you already opened. Do not repeat completed sections. Do not start new empty headings.";

export const LENGTH_CUTOFF_NOTICE =
  "This answer was cut off. Reply **continue** to finish the remaining sections.";

const HEADING_LINE_RE = /^\*\*[^*\n]+\*\*\s*$/;

/** True when the last **Heading** has no body (outline-then-quit). */
export function hasTrailingEmptyHeadings(content: string): boolean {
  const lines = content.replace(/\s+$/, "").split("\n");
  let lastHeading = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_LINE_RE.test(lines[i]!.trim())) {
      lastHeading = i;
    }
  }
  if (lastHeading < 0) {
    return false;
  }
  const after = lines
    .slice(lastHeading + 1)
    .join("\n")
    .trim();
  return after.length === 0;
}

export function shouldContinueForLengthStop(options: {
  finishReason?: string;
  content: string;
  alreadyContinued: boolean;
}): boolean {
  if (options.alreadyContinued) {
    return false;
  }
  if (options.finishReason === "length") {
    return true;
  }
  return hasTrailingEmptyHeadings(options.content);
}

export function withLengthCutoffNotice(content: string): string {
  const trimmed = content.trimEnd();
  if (trimmed.includes(LENGTH_CUTOFF_NOTICE)) {
    return content;
  }
  return `${trimmed}\n\n${LENGTH_CUTOFF_NOTICE}`;
}
