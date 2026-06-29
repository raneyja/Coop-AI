import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { DocsMarkdown } from "@/components/DocsMarkdown";
import { DocsNextSteps } from "@/components/DocsNextSteps";
import { DocsSearch } from "@/components/DocsSearch";
import { DocsSidebar } from "@/components/DocsSidebar";
import { docsInlineLinkClassName, docsProseClassName } from "@/lib/docsStyles";
import type { DocsNavEntry, DocsSection } from "@/lib/docs.shared";

type DocsArticleLayoutProps = {
  title: string;
  description?: string;
  lastUpdated?: string;
  content: string;
  sections: DocsSection[];
  navPages: DocsNavEntry[];
  currentSlug: string;
  prev?: DocsNavEntry;
  next?: DocsNavEntry;
  nextStepLinks?: { href: string; label: string }[];
};

export function DocsArticleLayout({
  title,
  description,
  lastUpdated,
  content,
  sections,
  navPages,
  currentSlug,
  prev,
  next,
  nextStepLinks
}: DocsArticleLayoutProps) {
  return (
    <>
      <PageHeader eyebrow="Documentation" title={title} description={description} tight />

      <section className="border-t border-coop-border pb-24 pt-8">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8 max-w-md">
            <DocsSearch pages={navPages} />
          </div>

          <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
            <aside className="mb-8 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
              <DocsSidebar sections={sections} currentSlug={currentSlug} />
              <p className="mt-8 hidden text-xs leading-relaxed text-coop-muted lg:block">
                Need a walkthrough? See the{" "}
                <Link href="/manual" className={docsInlineLinkClassName}>
                  Owner&apos;s Manual
                </Link>
              </p>
            </aside>

            <article className="min-w-0">
              {lastUpdated ? (
                <p className="mb-6 text-sm text-coop-muted">Last updated: {lastUpdated}</p>
              ) : null}
              <div className={docsProseClassName}>
                <DocsMarkdown content={content} />
              </div>
              <DocsNextSteps prev={prev} next={next} links={nextStepLinks} />
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
