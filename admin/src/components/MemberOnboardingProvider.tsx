"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchMe } from "@/lib/coopApi";
import { getStoredMe, isMemberRole } from "@/lib/auth";
import { MemberOnboardingWizard } from "./MemberOnboardingWizard";

type MemberOnboardingContextValue = {
  refresh: () => Promise<void>;
};

const MemberOnboardingContext = createContext<MemberOnboardingContextValue | null>(null);

export function useMemberOnboarding() {
  const ctx = useContext(MemberOnboardingContext);
  if (!ctx) {
    throw new Error("useMemberOnboarding must be used within MemberOnboardingProvider");
  }
  return ctx;
}

type MemberOnboardingProviderProps = {
  children: React.ReactNode;
};

export function MemberOnboardingProvider({ children }: MemberOnboardingProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const me = getStoredMe();
  const isMember = me ? isMemberRole(me) : false;

  const [showSetup, setShowSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!isMember) {
      setShowSetup(false);
      setReady(true);
      return;
    }
    const meResult = await fetchMe();
    setReady(true);
    if (meResult.ok && meResult.data) {
      setShowSetup(!meResult.data.memberOnboardingCompleted);
    }
  }, [isMember]);

  useEffect(() => {
    void load();
  }, [load]);

  const overlayVisible = showSetup && pathname === "/" && !dismissed;
  const showResumeBanner = showSetup && (pathname !== "/" || dismissed);

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
    <MemberOnboardingContext.Provider value={ctx}>
      {children}
      {showResumeBanner ? (
        <div className="fixed bottom-6 left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-lg border border-coop-border bg-coop-dark/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-sm">
          <p className="text-sm text-coop-muted">
            Finish your member setup to connect tools and install the extension.
          </p>
          <button type="button" className="admin-btn-primary shrink-0" onClick={continueSetup}>
            {dismissed ? "Resume setup" : "Continue setup"}
          </button>
        </div>
      ) : null}
      {overlayVisible && ready ? (
        <MemberOnboardingWizard
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
    </MemberOnboardingContext.Provider>
  );
}
