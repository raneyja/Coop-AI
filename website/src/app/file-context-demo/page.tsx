import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FileContextStoryDemo } from "@/components/FileContextStoryDemo";

export const metadata: Metadata = {
  title: "File Context Story — Preview",
  description: "Auto-playing demo: ask a question, search your stack, get a grounded answer.",
  robots: { index: false, follow: false }
};

export default function FileContextDemoPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Preview · not linked in nav"
        title="Ask a question. CoopAI searches your stack."
        description="Watch a developer type a real question, see CoopAI pull context from GitHub, GitLab, Slack, and Jira, then return an answer grounded in files and repos across the org."
      />

      <section className="pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-8 flex flex-wrap items-center justify-center gap-3 text-sm text-coop-muted">
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-200/90">
              Auto-playing demo
            </span>
            <Link href="/" className="text-coop-accent hover:text-white">
              ← Back to homepage
            </Link>
          </div>

          <FileContextStoryDemo />
        </div>
      </section>
    </>
  );
}
