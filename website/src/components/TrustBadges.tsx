import { siteConfig } from "@/lib/site.config";
import { FeatureCardGrid } from "./FeatureCardGrid";

export function TrustBadges({
  compact = false,
  small = false
}: {
  compact?: boolean;
  small?: boolean;
}) {
  return <FeatureCardGrid items={siteConfig.trustBadges} compact={compact} small={small} />;
}
