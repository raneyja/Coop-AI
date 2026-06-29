"use client";

import { useEffect, useState } from "react";
import { docsNavLinkClass, docsSectionLabelClassName } from "@/lib/docsStyles";
import type { ManualTocEntry } from "@/lib/manual.shared";

type ManualTocProps = {
  entries: ManualTocEntry[];
};

export function ManualToc({ entries }: ManualTocProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const h2Entries = entries.filter((entry) => entry.depth === 2);
    if (h2Entries.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    for (const entry of h2Entries) {
      const element = document.getElementById(entry.id);
      if (element) {
        observer.observe(element);
      }
    }

    const hash = window.location.hash.replace("#", "");
    if (hash) {
      setActiveId(hash);
    }

    return () => observer.disconnect();
  }, [entries]);

  const h2Sections = entries.filter((entry) => entry.depth === 2);

  function isLinkActive(entry: ManualTocEntry): boolean {
    return (
      activeId === entry.id ||
      (entry.depth === 2 && !activeId && entry.id === h2Sections[0]?.id)
    );
  }

  function renderLinks(compact = false) {
    return (
      <ul className={compact ? "space-y-2" : "space-y-1"}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.depth === 3 ? "ml-3 border-l border-coop-border pl-3" : undefined}
          >
            <a
              href={`#${entry.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth" });
                window.history.replaceState(null, "", `#${entry.id}`);
                setActiveId(entry.id);
              }}
              className={`block py-1 text-sm leading-snug ${docsNavLinkClass(isLinkActive(entry))}`}
            >
              {entry.title}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <details className="coop-panel mb-8 lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-900">
          Table of contents
        </summary>
        <nav aria-label="Table of contents" className="border-t border-coop-border px-4 py-4">
          {renderLinks(true)}
        </nav>
      </details>

      <nav
        aria-label="Table of contents"
        className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto"
      >
        <p className={docsSectionLabelClassName}>Contents</p>
        {renderLinks()}
      </nav>
    </>
  );
}
