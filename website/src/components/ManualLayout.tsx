import { PageHeader } from "@/components/PageHeader";
import { DocsMarkdown } from "@/components/DocsMarkdown";
import { ManualToc } from "@/components/ManualToc";
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
      />

      <section className="pb-24">
        <div className="mx-auto max-w-6xl px-6">
          {manual.lastUpdated ? (
            <p className="mb-8 text-center text-sm text-coop-muted lg:text-left">
              Last updated: {manual.lastUpdated}
            </p>
          ) : null}

          <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
            <ManualToc entries={manual.toc} />
            <article className="prose prose-lg prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-coop-index prose-code:text-coop-index prose-p:text-coop-muted prose-li:text-coop-muted prose-strong:text-white max-w-none min-w-0">
              <DocsMarkdown content={manual.content} />
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
