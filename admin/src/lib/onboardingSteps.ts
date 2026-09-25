import { planCapabilities } from "./planCapabilities";

export type OnboardingStepId =
  | "welcome"
  | "tools"
  | "indexing"
  | "scope"
  | "team"
  | "extension"
  | "done";

export type OnboardingStepDef = {
  id: OnboardingStepId;
  label: string;
  include: (plan: string) => boolean;
};

/** Single source for the admin setup wizard and the resume banner. */
export const ONBOARDING_STEP_DEFS: OnboardingStepDef[] = [
  { id: "welcome", label: "Welcome", include: () => true },
  { id: "tools", label: "Connect", include: () => true },
  {
    id: "indexing",
    label: "Index repos",
    include: (plan) => planCapabilities(plan).showOnboardingIndexingStep
  },
  {
    id: "scope",
    label: "Scope",
    include: (plan) => planCapabilities(plan).showScopeStep
  },
  {
    id: "team",
    label: "Team",
    include: (plan) => planCapabilities(plan).showOnboardingTeamStep
  },
  {
    id: "extension",
    label: "Extension",
    include: (plan) => planCapabilities(plan).showOnboardingExtensionStep
  },
  { id: "done", label: "Done", include: () => true }
];

export function onboardingStepsForPlan(plan: string): OnboardingStepDef[] {
  return ONBOARDING_STEP_DEFS.filter((entry) => entry.include(plan));
}
