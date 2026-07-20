import type { Metadata } from "next";
import { Suspense } from "react";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";
import { EmailPreviewContent } from "./EmailPreviewContent";

export const metadata: Metadata = buildPageMetadata(
  "/email-preview",
  "Email preview",
  "Layout preview for CoopAI transactional emails. Links here are not live account actions.",
  { robots: noIndexRobots }
);

export default function EmailPreviewPage() {
  return (
    <Suspense
      fallback={
        <section className="mx-auto max-w-lg px-6 pb-24 pt-16">
          <p className="text-sm text-coop-muted">Loading…</p>
        </section>
      }
    >
      <EmailPreviewContent />
    </Suspense>
  );
}
