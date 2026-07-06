import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FileContextStoryDemo } from "@/components/FileContextStoryDemo";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/file-context-demo",
  "File Context Story — Preview",
  "Auto-playing demo: deep questions, inline complete, and in-file edit in VS Code.",
  { robots: noIndexRobots }
);

export default function FileContextDemoPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Preview · not linked in nav"
        title="Understand deeply. Write in place."
        description="Watch scenarios alternate: deep questions with stack-wide search, graph-grounded inline completions, and in-file edits with inline diffs."
      />

      <section className="pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-8 flex flex-wrap items-center justify-center gap-3 text-sm text-coop-muted">
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-200/90">
              Auto-playing demo
            </span>
            <Link href="/" className="text-coop-index hover:text-white">
              ← Back to homepage
            </Link>
          </div>

          <FileContextStoryDemo />
        </div>
      </section>
    </>
  );
}
