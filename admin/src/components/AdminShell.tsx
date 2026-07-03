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
  restoreSessionFromCookie
} from "@/lib/auth";
import { IndexingProgressBar } from "./IndexingProgressBar";
import { OnboardingProvider } from "./OnboardingProvider";
import { MemberOnboardingProvider } from "./MemberOnboardingProvider";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type AdminShellProps = {
  children: React.ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
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
      </MemberOnboardingProvider>
    </OnboardingProvider>
  );
}
