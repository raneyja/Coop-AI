/**
 * Shared SEARCH/REPLACE sanity checks for /edit snap and agent propose_patch.
 */

export function countNeedleOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    count += 1;
    from = index + needle.length;
  }
  return count;
}

/** REPLACE pasted SEARCH more than once — the duplicate-signature / duplicate-block bug. */
export function replaceDuplicatesSearch(replace: string, search: string): boolean {
  const needle = search.trim();
  return needle.length >= 12 && countNeedleOccurrences(replace, needle) > 1;
}

export const REPLACE_DUPLICATES_SEARCH_ERROR =
  "REPLACE duplicates the SEARCH block. To add a comment above a line, SEARCH is the existing line once; REPLACE is the comment plus that line once.";
