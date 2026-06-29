"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { docsInlineLinkClassName } from "@/lib/docsStyles";
import type { DocsNavEntry } from "@/lib/docs.shared";

type DocsSearchProps = {
  pages: DocsNavEntry[];
};

export function DocsSearch({ pages }: DocsSearchProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    return pages
      .filter(
        (page) =>
          page.title.toLowerCase().includes(normalized) ||
          page.description?.toLowerCase().includes(normalized) ||
          page.slug.toLowerCase().includes(normalized)
      )
      .slice(0, 8);
  }, [pages, query]);

  return (
    <div className="relative">
      <label htmlFor="docs-search" className="sr-only">
        Search documentation
      </label>
      <input
        id="docs-search"
        type="search"
        placeholder="Search docs…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-sm border border-coop-border bg-white px-4 py-2.5 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-coop-index focus:outline-none focus:ring-1 focus:ring-coop-index/30"
      />
      {query.trim() && results.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full rounded-sm border border-coop-border bg-white py-2 shadow-lg">
          {results.map((page) => (
            <li key={page.slug}>
              <Link
                href={`/docs/${page.slug}`}
                className="block px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                onClick={() => setQuery("")}
              >
                <span className="font-medium text-gray-900">{page.title}</span>
                {page.description ? (
                  <span className="mt-0.5 block text-xs text-coop-muted">{page.description}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && (
        <p className="absolute z-20 mt-2 w-full rounded-sm border border-coop-border bg-white px-4 py-3 text-sm text-coop-muted shadow-lg">
          No results for &ldquo;{query}&rdquo;
        </p>
      )}
    </div>
  );
}
