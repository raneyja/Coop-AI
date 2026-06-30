import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/signup/free",
  "Free sign up",
  "Create your free CoopAI developer account.",
  { robots: noIndexRobots }
);

export default function FreeSignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
