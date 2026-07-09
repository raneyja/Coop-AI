"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnalyticsSectionNav } from "@/components/analytics/AnalyticsSectionNav";
import { getStoredMe, isAdminRole } from "@/lib/auth";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;

  useEffect(() => {
    if (!isAdmin && pathname === "/analytics") {
      router.replace("/analytics/my");
    }
  }, [isAdmin, pathname, router]);

  if (!isAdmin && pathname === "/analytics") {
    return null;
  }

  return (
    <>
      <AnalyticsSectionNav showOrganization={isAdmin} />
      {children}
    </>
  );
}
