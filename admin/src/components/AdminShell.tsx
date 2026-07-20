"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getToken,
  getStoredMe,
  isAdminRole,
  isMemberAllowedPath,
  defaultHomePath,
  isMemberRole,
  restoreSessionFromCookie,
  updateStoredMe,
  meFromAuthPayload
} from "@/lib/auth";
import { fetchMe, isOrgSuspendedResult } from "@/lib/coopApi";
import { isOrgMarkedSuspended, subscribeOrgSuspended, clearOrgSuspended } from "@/lib/orgSuspendedState";
import { IndexingProgressBar } from "./IndexingProgressBar";
import { OnboardingProvider } from "./OnboardingProvider";
import { MemberOnboardingProvider } from "./MemberOnboardingProvider";
import { OrgSuspendedOverlay } from "./OrgSuspendedOverlay";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type AdminShellProps = {
  children: React.ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [orgSuspended, setOrgSuspended] = useState(() => isOrgMarkedSuspended());
  const me = getStoredMe();
  const showGlobalIndexingProgress = Boolean(
    pathname && !pathname.startsWith("/indexing") && me && isAdminRole(me)
  );

  useEffect(() => {
    async function guard() {
      let token = getToken();
      if (!token) {
        const restored = await restoreSessionFromCookie();
        if (!restored) {
          router.replace("/login");
          return;
        }
        token = getToken();
      }

      const me = getStoredMe();
      if (me && isMemberRole(me) && !isMemberAllowedPath(pathname)) {
        router.replace(defaultHomePath(me));
        return;
      }
      setReady(true);
    }

    void guard();
  }, [router, pathname]);

  useEffect(() => {
    return subscribeOrgSuspended(setOrgSuspended);
  }, []);

  useEffect(() => {
    if (!ready) return;

    void fetchMe().then((result) => {
      if (isOrgSuspendedResult(result)) {
        setOrgSuspended(true);
        return;
      }
      if (result.ok && result.data) {
        clearOrgSuspended();
        setOrgSuspended(false);
        // Keep stored me in sync with the token's org (avoids stale name from another tab).
        updateStoredMe(meFromAuthPayload(result.data as Record<string, unknown>));
      }
    });
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark text-coop-muted">
        Loading…
      </div>
    );
  }

  return (
    <OnboardingProvider>
      <MemberOnboardingProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            {showGlobalIndexingProgress ? <IndexingProgressBar /> : null}
            <main id="admin-main-scroll" className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </div>
        </div>
        <OrgSuspendedOverlay open={orgSuspended} />
      </MemberOnboardingProvider>
    </OnboardingProvider>
  );
}
