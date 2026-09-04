import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/login",
  "Sign in",
  "Sign in to CoopAI in the VS Code extension.",
  { robots: noIndexRobots }
);

export { default } from "./LoginPage";
