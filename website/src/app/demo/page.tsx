import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ContactForm } from "@/components/ContactForm";
import { InstallExtensionButton } from "@/components/Button";

export const metadata: Metadata = {
  title: "Book a Demo",
  description: "Schedule a demo or join the CoopAI waitlist."
};

type DemoPageProps = {
  searchParams: Promise<{ intent?: string; prompt?: string }>;
};

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;
  const waitlistFirst = params.intent === "waitlist";
  const demoMessage = params.prompt?.trim()
    ? `I'd like to explore: "${params.prompt.trim()}"`
    : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Get started"
        title={waitlistFirst ? "Join the waitlist" : "Book a demo"}
        description={
          waitlistFirst
            ? "Be first to know when the CoopAI VS Code extension is available on the Marketplace."
            : "See CoopAI on your codebase. We'll schedule a walkthrough with your team."
        }
      />

      <section className="pb-24">
        <div
          className={`mx-auto grid max-w-5xl gap-8 px-6 ${waitlistFirst ? "max-w-xl" : "lg:grid-cols-2"}`}
        >
          {!waitlistFirst && (
            <ContactForm
              type="demo"
              title="Request a demo"
              description="Tell us about your team and we'll follow up within one business day."
              submitLabel="Book a demo"
              defaultMessage={demoMessage}
            />
          )}
          <ContactForm
            type="waitlist"
            title="Extension waitlist"
            description="The VS Code extension is in beta. Join the waitlist for Marketplace access."
            submitLabel="Join waitlist"
          />
          {!waitlistFirst && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 lg:col-span-2">
              <h3 className="text-lg font-semibold text-white">Prefer to try it yourself?</h3>
              <p className="mt-2 text-sm text-coop-muted">
                The free developer extension will be available on the VS Code Marketplace at launch.
                Until then, join the waitlist or book a demo for early access.
              </p>
              <div className="mt-4">
                <InstallExtensionButton />
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
