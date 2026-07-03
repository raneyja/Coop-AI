"use client";

import { getStoredMe, isMemberRole } from "@/lib/auth";
import { AdminDashboard } from "@/components/AdminDashboard";
import { MemberDashboard } from "@/components/MemberDashboard";

export default function DashboardPage() {
  const me = getStoredMe();
  if (me && isMemberRole(me)) {
    return <MemberDashboard />;
  }
  return <AdminDashboard />;
}
