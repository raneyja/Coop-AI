import Link from "next/link";
import { docsInlineLinkClassName } from "@/lib/docsStyles";
import type { DocsNavEntry } from "@/lib/docs.shared";

type DocsNextStepsProps = {
  prev?: DocsNavEntry;
  next?: DocsNavEntry;
  links?: { href: string; label: string }[];
};

export function DocsNextSteps({ prev, next, links }: DocsNextStepsProps) {
  return (
    <footer className="mt-16 space-y-8 border-t border-coop-border pt-10">
      {links && links.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Next steps</h2>
          <ul className="mt-4 space-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={`text-sm ${docsInlineLinkClassName}`}>
                  {link.label} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="coop-panel block p-4 transition hover:border-coop-index/50 hover:shadow-sm"
          >
            <p className="text-xs text-coop-muted">Previous</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{prev.title}</p>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            href={`/docs/${next.slug}`}
            className="coop-panel block p-4 text-right transition hover:border-coop-index/50 hover:shadow-sm sm:col-start-2"
          >
            <p className="text-xs text-coop-muted">Next</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{next.title}</p>
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
