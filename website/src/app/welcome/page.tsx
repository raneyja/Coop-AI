import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";
import { WelcomeContent } from "./WelcomeContent";

export const metadata: Metadata = buildPageMetadata(
  "/welcome",
  "Welcome",
  "Your Coop AI organization is ready.",
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
        title="You're all set"
        description="We emailed your admin portal link. Sign in with the password you chose at checkout."
        tight
      />

      <WelcomeContent sessionId={sessionId} fallbackAdminPortalLoginUrl={adminPortalLoginUrl} />
    </>
  );
}
