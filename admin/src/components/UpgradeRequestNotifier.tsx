"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  canAccessAdminPages,
  clearUpgradePopupDismissed,
  getStoredMe,
  isUpgradePopupDismissed,
  markUpgradePopupDismissed
} from "@/lib/auth";
import { fetchSeatUpgradeRequests, resolveSeatUpgradeRequest, type SeatUpgradeRequest } from "@/lib/coopApi";
import {
  convertSeatModalCopy,
  SEAT_CONVERT_TIMEOUT_MESSAGE,
  SEAT_CONVERT_TIMEOUT_MS,
  seatConvertErrorCopy,
  seatConvertProcessingCopy,
  seatConvertSuccessCopy,
  upgradeRequestNoticeCopy
} from "@/lib/billingCopy";
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
  const [busyAction, setBusyAction] = useState<"confirm" | "deny" | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = busyAction !== null;
  const confirmPhaseRef = useRef(confirmPhase);
  confirmPhaseRef.current = confirmPhase;

  const current = pending[0];
  const otherCount = Math.max(0, pending.length - 1);

  const showPopup = useCallback((requests: SeatUpgradeRequest[]) => {
    if (requests.length === 0 || pathname?.startsWith("/requests")) {
      setOpen(false);
      return;
    }
    setPending(requests);
    setOpen(true);
    setConfirmPhase("idle");
    setError(null);
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
      if (confirmPhaseRef.current !== "idle") {
        return;
      }
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

  useEffect(() => {
    if (confirmPhase !== "processing") {
      return;
    }
    const timer = window.setTimeout(() => {
      setError(SEAT_CONVERT_TIMEOUT_MESSAGE);
      setConfirmPhase("error");
      setBusyAction(null);
    }, SEAT_CONVERT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [confirmPhase]);

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
    setBusyAction(action);
    setError(null);
    if (action === "confirm") {
      setConfirmPhase("processing");
    }
    const result = await resolveSeatUpgradeRequest(current.id, action);
    setBusyAction(null);
    if (!result.ok) {
      setError(result.error ?? "Could not update that request.");
      if (action === "confirm") {
        setConfirmPhase("error");
      }
      return;
    }
    if (action === "confirm") {
      setConfirmPhase("success");
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

  function finishSuccess() {
    const remaining = pending.filter((request) => request.id !== current?.id);
    setPending(remaining);
    setConfirmPhase("idle");
    setError(null);
    if (remaining.length === 0) {
      setOpen(false);
      return;
    }
    showPopup(remaining);
  }

  function dismiss() {
    if (busyAction === "confirm" || confirmPhase === "processing") {
      return;
    }
    markUpgradePopupDismissed();
    setOpen(false);
    setError(null);
    setConfirmPhase("idle");
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
        <Modal
          open
          title={
            confirmPhase === "processing"
              ? seatConvertProcessingCopy({
                  fromName: tierName(current.fromTier),
                  toName: tierName(current.toTier)
                }).title
              : confirmPhase === "success"
                ? seatConvertSuccessCopy(tierName(current.toTier)).title
                : confirmPhase === "error"
                  ? seatConvertErrorCopy(tierName(current.fromTier), error ?? "").title
                  : notice.heading
          }
          onClose={dismiss}
        >
          {confirmPhase === "processing" ? (
            <div className="space-y-4" role="status">
              <p className="text-sm text-coop-muted">
                {
                  seatConvertProcessingCopy({
                    fromName: tierName(current.fromTier),
                    toName: tierName(current.toTier)
                  }).body
                }
              </p>
              <p className="text-sm text-white">Working… stay on this screen.</p>
            </div>
          ) : confirmPhase === "success" ? (
            <div className="space-y-4" role="status">
              <p className="text-sm text-coop-muted">{seatConvertSuccessCopy(tierName(current.toTier)).body}</p>
              <div className="flex justify-end">
                <button type="button" className="admin-btn-primary" onClick={finishSuccess}>
                  {seatConvertSuccessCopy(tierName(current.toTier)).doneLabel}
                </button>
              </div>
            </div>
          ) : confirmPhase === "error" ? (
            <div className="space-y-4" role="alert">
              <p className="text-sm text-red-400">
                {seatConvertErrorCopy(tierName(current.fromTier), error ?? "").reason}
              </p>
              <p className="text-sm text-coop-muted">
                {seatConvertErrorCopy(tierName(current.fromTier), error ?? "").stay}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className="admin-btn-secondary" onClick={dismiss}>
                  {seatConvertErrorCopy(tierName(current.fromTier), error ?? "").closeLabel}
                </button>
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => void handleResolve("confirm")}
                >
                  {seatConvertErrorCopy(tierName(current.fromTier), error ?? "").retryLabel}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-white">{notice.body}</p>
              <p className="text-sm text-coop-muted">{convertCopy.body}</p>
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
                  {busyAction === "deny" ? "Denying…" : "Deny"}
                </button>
                <button
                  type="button"
                  className="admin-btn-primary"
                  disabled={busy}
                  onClick={() => void handleResolve("confirm")}
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
