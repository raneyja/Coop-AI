import { planBadgeClass, planLabel } from "@/lib/coopApi";

type PlanBadgeProps = {
  plan: string;
  usageTier?: string | null;
};

export function PlanBadge({ plan, usageTier }: PlanBadgeProps) {
  return <span className={planBadgeClass(plan, usageTier)}>{planLabel(plan, usageTier)}</span>;
}
