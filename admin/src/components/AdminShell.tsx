"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import { IndexingProgressBar } from "./IndexingProgressBar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type AdminShellProps = {
  children: React.ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const showGlobalIndexingProgress = Boolean(pathname && !pathname.startsWith("/indexing"));

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark text-coop-muted">
        Loading…
      </div>
    );
  }

  return (
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
  );
}
