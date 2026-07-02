import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/login",
  "Sign in",
  "Sign in to your Coop AI account.",
  { robots: noIndexRobots }
);

export { default } from "./LoginPage";
