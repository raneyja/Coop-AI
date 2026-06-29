"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
        className="w-full rounded-sm border border-coop-border bg-coop-editor px-4 py-2.5 font-mono text-sm text-white placeholder:text-coop-muted/60 focus:border-coop-index focus:outline-none"
      />
      {query.trim() && results.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full rounded-sm border border-coop-border bg-coop-editor py-2 shadow-lg">
          {results.map((page) => (
            <li key={page.slug}>
              <Link
                href={`/docs/${page.slug}`}
                className="block px-4 py-2 text-sm text-coop-muted hover:bg-coop-surface hover:text-white"
                onClick={() => setQuery("")}
              >
                <span className="text-white">{page.title}</span>
                {page.description ? (
                  <span className="mt-0.5 block text-xs text-coop-muted">{page.description}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && (
        <p className="absolute z-20 mt-2 w-full rounded-sm border border-coop-border bg-coop-editor px-4 py-3 text-sm text-coop-muted">
          No results for &ldquo;{query}&rdquo;
        </p>
      )}
    </div>
  );
}
