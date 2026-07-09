"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { fetchOrg } from "@/lib/coopApi";

type SettingsNavItem = {
  href: string;
  title: string;
  description: string;
};

export default function SettingsPage() {
  const me = getStoredMe();
  const isAdmin = me ? isAdminRole(me) : false;
  const [orgPlan, setOrgPlan] = useState<string>(me?.plan ?? "free");

  const load = useCallback(async () => {
    const result = await fetchOrg();
    if (result.ok && result.data) {
      setOrgPlan(result.data.plan);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showRepoAccess = isAdmin && (orgPlan === "pro" || orgPlan === "enterprise");
  const showSso = isAdmin && orgPlan === "enterprise";

  const items: SettingsNavItem[] = [
    {
      href: "/settings/account",
      title: "Account & organization",
      description: isAdmin
        ? "Manage your account, organization, and portal preferences."
        : "Your account and portal preferences."
    }
  ];

  if (showRepoAccess) {
    items.push({
      href: "/settings/repository-access",
      title: "Repository access",
      description: "Control which Deep-Indexed repos developers can use in VS Code."
    });
  }

  if (showSso) {
    items.push({
      href: "/settings/single-sign-on",
      title: "Single sign-on",
      description: "Let your team sign in with your company identity provider (SAML 2.0)."
    });
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="admin-page-title">Settings</h1>
        <p className="mt-1 text-sm text-coop-muted">Choose what you want to manage.</p>
      </div>

      <nav className="admin-card divide-y divide-coop-border/40" aria-label="Settings sections">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="admin-list-row block px-4 first:pt-1 last:pb-1 hover:bg-white/[0.02]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-white">{item.title}</span>
              <span className="mt-1 block text-sm text-coop-muted">{item.description}</span>
            </span>
            <span className="shrink-0 text-coop-muted" aria-hidden>
              →
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
