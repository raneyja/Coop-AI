import type { Metadata } from "next";
import { buildPageMetadata, noIndexRobots } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata(
  "/signup",
  "Sign up",
  "Start CoopAI Pro for yourself, or buy seats for a team.",
  { robots: noIndexRobots }
);

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
