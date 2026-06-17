import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import { WelcomeContent } from "./WelcomeContent";

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
  const adminPortalLoginUrl = getAdminPortalLoginUrl();

  return (
    <>
      <PageHeader
        eyebrow="Checkout complete"
        title="You're all set"
        description="We sent your admin API key and portal link to your email."
        tight
      />

      <WelcomeContent sessionId={sessionId} fallbackAdminPortalLoginUrl={adminPortalLoginUrl} />
    </>
  );
}
