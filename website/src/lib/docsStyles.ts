/** Shared typography and nav styles for /manual and /docs (light site theme). */

export const docsProseClassName =
  "prose prose-lg max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-gray-900 prose-p:text-gray-700 prose-p:leading-relaxed prose-li:text-gray-700 prose-strong:text-gray-900 prose-strong:font-semibold prose-a:text-coop-index prose-a:no-underline hover:prose-a:text-coop-blue prose-code:rounded prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-gray-800 prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-coop-border prose-pre:bg-gray-50 prose-blockquote:border-l-coop-index prose-blockquote:text-gray-600 prose-th:text-gray-900 prose-td:text-gray-700";

export const docsHeadingH2ClassName =
  "scroll-mt-24 mt-16 mb-4 text-2xl font-semibold tracking-tight text-gray-900 first:mt-0";

export const docsHeadingH3ClassName =
  "scroll-mt-24 mt-10 mb-3 text-lg font-semibold tracking-tight text-gray-900";

export function docsNavLinkClass(isActive: boolean): string {
  return isActive
    ? "font-medium text-coop-index"
    : "text-coop-muted transition-colors hover:text-gray-900";
}

export const docsInlineLinkClassName =
  "text-coop-index no-underline transition-colors hover:text-coop-blue";

export const docsFigureClassName =
  "not-prose my-6 mx-auto block max-w-xl overflow-hidden rounded-sm border border-coop-border bg-gray-50 shadow-sm";

export const docsFigureCaptionClassName =
  "not-prose -mt-4 mb-8 max-w-xl mx-auto text-center text-sm text-gray-500";

export const docsFigureGridClassName =
  "not-prose my-6 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2";

// Compact variants: ~20% smaller max widths for the Owner's Manual.
export const docsFigureCompactClassName =
  "not-prose my-6 mx-auto block max-w-[28.8rem] overflow-hidden rounded-sm border border-coop-border bg-gray-50 shadow-sm";

export const docsFigureCompactCaptionClassName =
  "not-prose -mt-4 mb-8 max-w-[28.8rem] mx-auto text-center text-sm text-gray-500";

export const docsFigureGridCompactClassName =
  "not-prose my-6 grid max-w-[44.8rem] grid-cols-1 gap-4 sm:grid-cols-2";

export const docsFigureSingleClassName = "not-prose my-6 max-w-4xl";

export const docsFigureSingleCompactClassName = "not-prose my-6 max-w-[44.8rem]";

// Medium single figure: 25% narrower than standard docs figures.
export const docsFigureSingleMediumClassName = "not-prose my-6 max-w-[42rem]";

// Small single figure: ~40% narrower than compact, for tall/portrait screenshots.
export const docsFigureSingleSmallClassName = "not-prose my-6 max-w-[26.9rem]";

export const docsFigureTileClassName =
  "block overflow-hidden rounded-sm border border-coop-border bg-gray-50 shadow-sm";

export const docsFigureGridCaptionClassName =
  "mt-2 text-center text-xs leading-relaxed text-gray-500";

export const docsSectionLabelClassName = "mb-4 font-mono text-xs text-gray-500";
