import { billingPlanLabel } from "@/lib/billingCopy";
import { planBadgeClass } from "@/lib/coopApi";

type PlanBadgeProps = {
  plan: string;
  usageTier?: string | null;
  seats?: number | null;
};

export function PlanBadge({ plan, usageTier, seats }: PlanBadgeProps) {
  return (
    <span className={planBadgeClass(plan, usageTier)}>
      {billingPlanLabel({ plan, usageTier, seats })}
    </span>
  );
}
