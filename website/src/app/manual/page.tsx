import type { Metadata } from "next";
import { ManualLayout } from "@/components/ManualLayout";
import { getManual } from "@/lib/manual";
import { buildPageMetadata } from "@/lib/pageMetadata";

export function generateMetadata(): Metadata {
  const manual = getManual();
  return buildPageMetadata("/manual", "Owner's Manual", manual.description);
}

export default function ManualPage() {
  const manual = getManual();
  return <ManualLayout manual={manual} />;
}
