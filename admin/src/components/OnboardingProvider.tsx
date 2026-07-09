"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { completeOnboarding, fetchOrg } from "@/lib/coopApi";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { clearSetupDismiss, isSetupDismissedToday, recordSetupDismiss } from "@/lib/onboardingDismiss";
import { OnboardingWizard } from "./OnboardingWizard";

const SETUP_HELPER_PATHS = new Set(["/integrations", "/users", "/indexing", "/api-keys"]);

const FULL_STEP_LABELS = [
  "Welcome",
  "Connect tools",
  "Index repos",
  "Manage access",
  "Invite team",
  "Done"
] as const;

const FREE_STEP_LABELS = ["Welcome", "Connect", "Index repos", "Extension", "Done"] as const;

type OnboardingContextValue = {
  refresh: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}

type OnboardingProviderProps = {
  children: React.ReactNode;
};

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const me = getStoredMe();
  const plan = me?.plan ?? "free";
  const isAdmin = me ? isAdminRole(me) : false;
  const stepLabels = plan === "free" ? FREE_STEP_LABELS : FULL_STEP_LABELS;

  const [showSetup, setShowSetup] = useState(false);
  const [dismissedToday, setDismissedToday] = useState(() => isSetupDismissedToday("admin"));
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) {
      setShowSetup(false);
      setReady(true);
      return;
    }
    const orgResult = await fetchOrg();
    setReady(true);
    if (orgResult.ok && orgResult.data) {
      setShowSetup(!orgResult.data.onboardingCompleted);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (step >= stepLabels.length) {
      setStep(stepLabels.length - 1);
    }
  }, [step, stepLabels.length]);

  const handleDismiss = useCallback(async () => {
    const result = recordSetupDismiss("admin");
    setDismissedToday(true);
    if (result.permanent) {
      await completeOnboarding();
      setShowSetup(false);
      void load();
      return;
    }
  }, [load]);

  const onHelperPage = Boolean(pathname && SETUP_HELPER_PATHS.has(pathname));
  const overlayVisible = showSetup && !onHelperPage && !dismissedToday;
  const showResumeBanner = showSetup && onHelperPage && !dismissedToday;

  function continueSetup() {
    if (pathname !== "/") {
      router.push("/");
    }
  }

  const ctx = useMemo(
    () => ({
      refresh: load
    }),
    [load]
  );

  return (
    <OnboardingContext.Provider value={ctx}>
      {children}
      {showResumeBanner ? (
        <div className="fixed bottom-6 left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-lg border border-coop-border bg-coop-dark/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-sm">
          <p className="text-sm text-coop-muted">
            Setup in progress · Step {Math.min(step + 1, stepLabels.length)} of {stepLabels.length} —{" "}
            <span className="text-white">{stepLabels[step] ?? "Setup"}</span>
          </p>
          <button type="button" className="admin-btn-primary shrink-0" onClick={continueSetup}>
            Continue setup
          </button>
        </div>
      ) : null}
      {overlayVisible && ready ? (
        <OnboardingWizard
          step={step}
          onStepChange={setStep}
          onDismiss={() => void handleDismiss()}
          onComplete={() => {
            clearSetupDismiss("admin");
            setDismissedToday(false);
            setShowSetup(false);
            void load();
          }}
        />
      ) : null}
    </OnboardingContext.Provider>
  );
}
