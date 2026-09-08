import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";
import { WelcomeContent } from "./WelcomeContent";

export const metadata: Metadata = buildPageMetadata(
  "/welcome",
  "Welcome",
  "Check your email to activate your CoopAI account.",
  { robots: noIndexRobots }
);

type WelcomePageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  const params = await searchParams;
  const sessionId = params.session_id?.trim();
  const adminPortalLoginUrl = getAdminPortalLoginUrl();

  return (
    <>
      <PageHeader
        eyebrow="Checkout complete"
        title="Check your email"
        description="Look for Activate your account. Set a password there."
        tight
      />

      <WelcomeContent sessionId={sessionId} fallbackAdminPortalLoginUrl={adminPortalLoginUrl} />
    </>
  );
}
