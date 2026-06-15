import { planBadgeClass, planLabel } from "@/lib/coopApi";

type PlanBadgeProps = {
  plan: string;
};

export function PlanBadge({ plan }: PlanBadgeProps) {
  return <span className={planBadgeClass(plan)}>{planLabel(plan)}</span>;
}
