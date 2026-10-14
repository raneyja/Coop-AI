import type { Metadata } from "next";
import { HomepagePreview } from "@/components/homepage-preview/HomepagePreview";

export const metadata: Metadata = {
  title: { absolute: "Homepage design preview · CoopAI" },
  description: "A local design preview of CoopAI's shared organizational context in the editor.",
  robots: { index: false, follow: false }
};

export default function HomepagePreviewPage() {
  return <HomepagePreview />;
}
