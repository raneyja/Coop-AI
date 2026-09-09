"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  canAccessAdminPages,
  clearUpgradePopupDismissed,
  getStoredMe,
  isUpgradePopupDismissed,
  markUpgradePopupDismissed
} from "@/lib/auth";
import { fetchSeatUpgradeRequests, resolveSeatUpgradeRequest, type SeatUpgradeRequest } from "@/lib/coopApi";
import { convertSeatModalCopy, upgradeRequestNoticeCopy } from "@/lib/billingCopy";
import { displayUsageTierName } from "@/lib/planNudge";
import { Modal } from "./Modal";

function tierName(value: string): string {
  if (value === "pro_plus" || value === "max" || value === "pro") {
    return displayUsageTierName(value);
  }
  return value;
}

export function UpgradeRequestNotifier() {
  const router = useRouter();
  const pathname = usePathname();
  const me = getStoredMe();
  const isAdmin = me ? canAccessAdminPages(me) : false;
  const [pending, setPending] = useState<SeatUpgradeRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = pending[0];
  const otherCount = Math.max(0, pending.length - 1);

  const showPopup = useCallback((requests: SeatUpgradeRequest[]) => {
    if (requests.length === 0 || pathname?.startsWith("/requests")) {
      setOpen(false);
      return;
    }
    setPending(requests);
    setOpen(true);
  }, [pathname]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    async function poll() {
      const result = await fetchSeatUpgradeRequests();
      if (!result.ok) {
        return;
      }
      const next = (result.data?.requests ?? []).filter((request) => (request.status ?? "pending") === "pending");
      setPending(next);
      if (next.length === 0) {
        setOpen(false);
        return;
      }
      if (!isUpgradePopupDismissed()) {
        showPopup(next);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 30000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAdmin, showPopup]);

  if (!isAdmin) {
    return null;
  }

  const notice = current
    ? upgradeRequestNoticeCopy({
        memberEmail: current.memberEmail,
        toName: tierName(current.toTier),
        otherPendingCount: otherCount
      })
    : null;
  const convertCopy = current
    ? convertSeatModalCopy({
        fromName: tierName(current.fromTier),
        toName: tierName(current.toTier),
        memberEmail: current.memberEmail
      })
    : null;

  async function handleResolve(action: "confirm" | "deny") {
    if (!current) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await resolveSeatUpgradeRequest(current.id, action);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update that request.");
      return;
    }
    const remaining = pending.filter((request) => request.id !== current.id);
    setPending(remaining);
    if (remaining.length === 0) {
      setOpen(false);
      return;
    }
    showPopup(remaining);
  }

  function dismiss() {
    markUpgradePopupDismissed();
    setOpen(false);
    setError(null);
  }

  return (
    <>
      {pending.length > 0 && !pathname?.startsWith("/requests") ? (
        <button
          type="button"
          className="admin-btn-secondary inline-flex items-center gap-2 text-xs"
          onClick={() => {
            clearUpgradePopupDismissed();
            setError(null);
            showPopup(pending);
          }}
        >
          <span className="admin-notice-dot" aria-hidden />
          {pending.length} upgrade request{pending.length === 1 ? "" : "s"}
        </button>
      ) : null}
      {open && current && notice && convertCopy ? (
        <Modal open title={notice.heading} onClose={dismiss}>
          <div className="space-y-4">
            <p className="text-sm text-white">{notice.body}</p>
            <p className="text-sm text-coop-muted">{convertCopy.body}</p>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <p className="text-xs text-coop-muted">
              Later hides this until you sign in again. The request stays open. Use the red dot in the header to
              bring it back now.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="admin-btn-secondary" onClick={dismiss} disabled={busy}>
                Later
              </button>
              <button
                type="button"
                className="admin-btn-secondary"
                disabled={busy}
                onClick={() => {
                  dismiss();
                  router.push("/requests");
                }}
              >
                See request
              </button>
              <button
                type="button"
                className="admin-btn-secondary"
                disabled={busy}
                onClick={() => void handleResolve("deny")}
              >
                Deny
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                disabled={busy}
                onClick={() => void handleResolve("confirm")}
              >
                {busy ? "Updating…" : "Confirm"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
