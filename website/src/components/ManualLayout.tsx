import { PageHeader } from "@/components/PageHeader";
import { DocsMarkdown } from "@/components/DocsMarkdown";
import { ManualToc } from "@/components/ManualToc";
import { docsProseClassName } from "@/lib/docsStyles";
import type { ManualContent } from "@/lib/manual.shared";

type ManualLayoutProps = {
  manual: ManualContent;
};

export function ManualLayout({ manual }: ManualLayoutProps) {
  return (
    <>
      <PageHeader
        eyebrow="Owner's Manual"
        title={manual.title}
        description={manual.description}
        tight
      />

      <section className="border-t border-coop-border pb-24 pt-8">
        <div className="mx-auto max-w-6xl px-6">
          {manual.lastUpdated ? (
            <p className="mb-8 text-sm text-coop-muted lg:mb-6">Last updated: {manual.lastUpdated}</p>
          ) : null}

          <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
            <ManualToc entries={manual.toc} />
            <article className={`min-w-0 ${docsProseClassName}`}>
              <DocsMarkdown content={manual.content} compact />
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
