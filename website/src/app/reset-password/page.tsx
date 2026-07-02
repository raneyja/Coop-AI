import { Suspense } from "react";
import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";
import ResetPasswordPage from "./ResetPasswordPage";

export const metadata: Metadata = buildPageMetadata(
  "/reset-password",
  "Reset password",
  "Choose a new password for your Coop AI account.",
  { robots: noIndexRobots }
);

export default function Page() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-lg px-6 pb-24 text-sm text-coop-muted">Loading…</p>}>
      <ResetPasswordPage />
    </Suspense>
  );
}
