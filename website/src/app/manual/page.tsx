import type { Metadata } from "next";
import { ManualLayout } from "@/components/ManualLayout";
import { getManual } from "@/lib/manual";

export function generateMetadata(): Metadata {
  const manual = getManual();
  return {
    title: "Owner's Manual",
    description: manual.description,
    openGraph: {
      title: "Coop AI Owner's Manual",
      description: manual.description
    }
  };
}

export default function ManualPage() {
  const manual = getManual();
  return <ManualLayout manual={manual} />;
}
