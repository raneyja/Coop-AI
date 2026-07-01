"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchOrg } from "@/lib/coopApi";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { OnboardingWizard } from "./OnboardingWizard";

const SETUP_HELPER_PATHS = new Set(["/integrations", "/users", "/indexing", "/api-keys"]);

const FULL_STEP_LABELS = [
  "Welcome",
  "Connect tools",
  "Manage access",
  "Invite team",
  "Verify",
  "Done"
] as const;

const FREE_STEP_LABELS = ["Welcome", "Connect", "Index repos", "API key", "Done"] as const;

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
  const isAdmin = me ? isAdminRole(me) : true;
  const stepLabels = plan === "free" ? FREE_STEP_LABELS : FULL_STEP_LABELS;

  const [showSetup, setShowSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);
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

  const onHelperPage = Boolean(pathname && SETUP_HELPER_PATHS.has(pathname));
  const overlayVisible = showSetup && !onHelperPage && !dismissed;
  const showResumeBanner = showSetup && (onHelperPage || dismissed);

  function continueSetup() {
    setDismissed(false);
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
            {dismissed && !onHelperPage ? "Resume setup" : "Continue setup"}
          </button>
        </div>
      ) : null}
      {overlayVisible && ready ? (
        <OnboardingWizard
          step={step}
          onStepChange={setStep}
          onDismiss={() => setDismissed(true)}
          onComplete={() => {
            setShowSetup(false);
            setDismissed(false);
            void load();
          }}
        />
      ) : null}
    </OnboardingContext.Provider>
  );
}
