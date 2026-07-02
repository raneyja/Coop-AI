import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/forgot-password",
  "Forgot password",
  "Reset your Coop AI account password.",
  { robots: noIndexRobots }
);

export { default } from "./ForgotPasswordPage";
