"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnalyticsSectionNav } from "@/components/analytics/AnalyticsSectionNav";
import { shouldShowOrganizationAnalytics } from "@/lib/analyticsAccess";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { fetchUsers } from "@/lib/coopApi";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setMemberCount(0);
      return;
    }
    let cancelled = false;
    void fetchUsers().then((result) => {
      if (cancelled) {
        return;
      }
      // Fail closed: hide Organization if the member list cannot load.
      setMemberCount(result.ok && result.data ? result.data.users.length : 1);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const accessResolved = !isAdmin || memberCount != null;
  const showOrganization = shouldShowOrganizationAnalytics(isAdmin, memberCount);
  const onOrgRoute = pathname === "/analytics";

  useEffect(() => {
    if (!accessResolved) {
      return;
    }
    if (!showOrganization && onOrgRoute) {
      router.replace("/analytics/my");
    }
  }, [accessResolved, showOrganization, onOrgRoute, router]);

  if (!accessResolved && onOrgRoute) {
    return null;
  }

  if (!showOrganization && onOrgRoute) {
    return null;
  }

  return (
    <>
      <AnalyticsSectionNav showOrganization={showOrganization} />
      {children}
    </>
  );
}
