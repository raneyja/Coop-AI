"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, displayOrgName, getStoredMe, signOutRemote } from "@/lib/auth";
import { ORG_SUSPENDED_SALES_EMAIL } from "@/lib/coopApi";

type OrgSuspendedOverlayProps = {
  open: boolean;
  /**
   * `session` — user reached the portal while suspended (Sign out).
   * `sign-in` — blocked at login; Dismiss returns to the form.
   */
  variant?: "session" | "sign-in";
  onDismiss?: () => void;
  /** Optional override when the API names the suspended org (preferred over cached me). */
  orgName?: string;
};

/**
 * Blocking notice when the org has been suspended.
 * Non-dismissible via Escape / backdrop — user contacts sales or leaves via the secondary action.
 */
export function OrgSuspendedOverlay({
  open,
  variant = "session",
  onDismiss,
  orgName: orgNameProp
}: OrgSuspendedOverlayProps) {
  const router = useRouter();
  const orgLabel = orgNameProp?.trim() || displayOrgName(getStoredMe());
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    const signedOut = await signOutRemote();
    setSigningOut(false);
    if (!signedOut) {
      setSignOutError("Could not sign out. Please try again.");
      return;
    }
    clearSession();
    router.replace("/login");
  }

  function handleSecondary() {
    if (variant === "sign-in") {
      onDismiss?.();
      return;
    }
    void signOut();
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="org-suspended-title"
        aria-describedby="org-suspended-desc"
        className="relative z-10 w-full max-w-md rounded-md border border-coop-border bg-coop-dark p-6 shadow-xl"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-red-400">Account suspended</p>
        <h2 id="org-suspended-title" className="mt-2 text-lg font-semibold text-white">
          {orgLabel} has been suspended
        </h2>
        <p id="org-suspended-desc" className="mt-3 text-sm leading-relaxed text-coop-muted">
          Access to Coop for this organization is currently blocked. Contact{" "}
          <a
            href={`mailto:${ORG_SUSPENDED_SALES_EMAIL}`}
            className="font-medium text-white underline underline-offset-2 hover:text-white/90"
          >
            {ORG_SUSPENDED_SALES_EMAIL}
          </a>{" "}
          regarding your account access.
        </p>
        {signOutError ? <p role="alert" className="mt-3 text-sm text-red-300">{signOutError}</p> : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={handleSecondary} disabled={signingOut} className="admin-btn-secondary">
            {variant === "sign-in" ? "Back to sign in" : signingOut ? "Signing out…" : "Sign out"}
          </button>
          <a href={`mailto:${ORG_SUSPENDED_SALES_EMAIL}`} className="admin-btn-primary text-center">
            Contact sales
          </a>
        </div>
      </div>
    </div>
  );
}
