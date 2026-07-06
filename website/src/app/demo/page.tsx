import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ContactForm } from "@/components/ContactForm";
import { InstallExtensionButton } from "@/components/Button";
import { installExtensionHref } from "@/lib/site.config";

export const metadata: Metadata = {
  title: "Book a Demo",
  description: "Schedule a demo with the CoopAI team."
};

type DemoPageProps = {
  searchParams: Promise<{ intent?: string; prompt?: string }>;
};

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;

  if (params.intent === "waitlist") {
    redirect(installExtensionHref());
  }

  const demoMessage = params.prompt?.trim()
    ? `I'd like to explore: "${params.prompt.trim()}"`
    : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Get started"
        title="Book a demo"
        description="See CoopAI on your codebase. We'll schedule a walkthrough with your team."
      />

      <section className="pb-24">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 lg:grid-cols-2">
          <ContactForm
            title="Request a demo"
            description="Tell us about your team and we'll follow up within one business day."
            submitLabel="Book a demo"
            defaultMessage={demoMessage}
          />
          <div className="coop-panel p-8">
            <h3 className="text-lg font-semibold text-gray-900">Prefer to try it yourself?</h3>
            <p className="mt-2 text-sm text-coop-muted">
              Install the free CoopAI extension from the VS Code Marketplace and sign in with your
              work email. See the{" "}
              <Link href="/docs/install-extension" className="text-gray-900 underline">
                install guide
              </Link>{" "}
              for marketplace and VSIX options.
            </p>
            <div className="mt-4">
              <InstallExtensionButton />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
