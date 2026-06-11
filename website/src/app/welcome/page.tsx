import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Your Coop AI organization is ready."
};

type WelcomePageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  const params = await searchParams;
  const sessionId = params.session_id?.trim();
  const adminPortal =
    process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";

  return (
    <>
      <PageHeader
        title="You're all set"
        description="Check your email for your admin API key and portal link. Connect your tools, invite your team, and developers can install the VS Code extension."
      />

      <section className="mx-auto max-w-2xl space-y-6 px-6 pb-24 text-coop-muted">
        {sessionId && (
          <div className="rounded-sm border border-coop-border bg-coop-surface/40 px-4 py-3 text-sm">
            <p className="text-white/90">Provisioning may take a minute.</p>
            <p className="mt-1 text-coop-muted">
              Your organization is being set up after checkout. If the admin portal is not ready yet,
              wait a moment and try again.
            </p>
            <p className="mt-2 font-mono text-xs text-coop-muted">Session: {sessionId}</p>
          </div>
        )}

        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>Open the admin portal and sign in with the API key in your email.</li>
          <li>Connect GitHub, Slack, and other tools once for your whole org.</li>
          <li>Invite teammates from the Users page.</li>
          <li>Developers install Coop AI in VS Code and sign in.</li>
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button href={adminPortal}>Open admin portal</Button>
          {sessionId && (
            <Button href={adminPortal} variant="secondary">
              Retry admin portal
            </Button>
          )}
          <Button href="/docs" variant="secondary">
            Install guide
          </Button>
        </div>
        <p className="text-xs">
          Didn&apos;t get the email? Check spam or{" "}
          <Link href="/demo" className="text-coop-accent hover:underline">
            contact support
          </Link>
          .
        </p>
      </section>
    </>
  );
}
