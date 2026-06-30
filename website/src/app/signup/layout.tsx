import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/signup",
  "Sign up",
  "Create your CoopAI organization.",
  { robots: noIndexRobots }
);

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
