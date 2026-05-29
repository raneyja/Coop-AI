import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Documentation",
  description: "CoopAI documentation — coming soon."
};

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Docs"
        title="Documentation coming soon"
        description="We're building thorough docs for installation, configuration, API reference, and enterprise deployment — inspired by best-in-class developer doc experiences."
      />

      <section className="pb-24">
        <div className="mx-auto max-w-2xl px-6">
          <div className="rounded-2xl border border-white/10 bg-coop-surface/30 p-8">
            <h2 className="text-lg font-semibold text-white">Planned sections</h2>
            <ul className="mt-4 space-y-2 text-sm text-coop-muted">
              <li>Getting started — server, extension, and first chat</li>
              <li>Quick actions reference</li>
              <li>API v1 — chat, inline completion, health</li>
              <li>Graph, webhooks, and job queue</li>
              <li>Zero-retention LLM configuration</li>
              <li>Enterprise deployment & BYOK</li>
            </ul>
            <p className="mt-6 text-sm text-coop-muted">
              In the meantime, see the{" "}
              <Link href="/product" className="text-coop-accent hover:text-white">
                Product page
              </Link>{" "}
              or{" "}
              <Link href="/demo" className="text-coop-accent hover:text-white">
                book a demo
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
