import { Suspense } from "react";
import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";
import VerifyEmailPage from "./VerifyEmailPage";

export const metadata: Metadata = buildPageMetadata(
  "/verify-email",
  "Verify email",
  "Confirm your Coop AI email address.",
  { robots: noIndexRobots }
);

export default function Page() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-lg px-6 pb-24 text-sm text-coop-muted">Loading…</p>}>
      <VerifyEmailPage />
    </Suspense>
  );
}
