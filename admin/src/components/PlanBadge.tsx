import { planBadgeClass, planLabel } from "@/lib/coopApi";

type PlanBadgeProps = {
  plan: string;
};

export function PlanBadge({ plan }: PlanBadgeProps) {
  return (
    <span className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[11px] ${planBadgeClass(plan)}`}>
      {planLabel(plan)}
    </span>
  );
}
