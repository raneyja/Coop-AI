import { siteConfig } from "@/lib/site.config";
import { FeatureCardGrid } from "./FeatureCardGrid";

export function TrustBadges({ compact = false }: { compact?: boolean }) {
  return <FeatureCardGrid items={siteConfig.trustBadges} compact={compact} />;
}
