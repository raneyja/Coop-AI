import React, { useEffect, useState } from "react";
import {
  formatFreeAllowanceCopy,
  isPaidQuotaPool,
  PAID_USAGE_EXHAUSTED_COPY,
  type QuotaUpgradeAction
} from "../../chat/quotaNotice";
import { DEMO_PAGE_URL } from "../../config/siteConfig";
import { ownSeatConvertCopy, seatConvertProcessingCopy } from "../../server/usageTiers";
import { CoopNotice } from "./CoopNotice";

export type QuotaExceededNoticeState = {
  resetsAt: string;
  upgradeUrl: string;
  timezone?: string;
  message?: string;
  pool?: "paid" | "auto" | "frontier" | "free";
  blockedWindow?: "cycle" | "week";
  upgradeAction?: QuotaUpgradeAction;
  nextTier?: "pro_plus" | "max";
  nextTierLabel?: string;
  upgradeConfirming?: boolean;
};

type QuotaExceededNoticeProps = {
  notice: QuotaExceededNoticeState;
  onDismiss: () => void;
  onUpgradeToPro?: () => void;
  onConvertOwnSeat?: (usageTier: "pro_plus" | "max") => void;
  onRequestSeatUpgrade?: (usageTier: "pro_plus" | "max") => void;
  convertResult?: { ok: boolean; message: string } | null;
};

export function QuotaExceededNotice({
  notice,
  onDismiss,
  onUpgradeToPro,
  onConvertOwnSeat,
  onRequestSeatUpgrade,
  convertResult
}: QuotaExceededNoticeProps): React.ReactElement {
  const paid = isPaidQuotaPool(notice.pool);
  const action = notice.upgradeAction ?? (paid ? "none" : "checkout-pro");
  const nextLabel = notice.nextTierLabel ?? (notice.nextTier === "max" ? "Max" : "Pro+");
  const [convertPhase, setConvertPhase] = useState<"idle" | "confirm" | "processing" | "error">("idle");
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    if (!convertResult || convertPhase !== "processing") {
      return;
    }
    if (convertResult.ok) {
      setConvertPhase("idle");
      setConvertError(null);
      return;
    }
    setConvertPhase("error");
    setConvertError(convertResult.message);
  }, [convertResult, convertPhase]);

  const body = paid
    ? notice.message?.trim() || PAID_USAGE_EXHAUSTED_COPY
    : formatFreeAllowanceCopy({
        resetsAt: notice.resetsAt,
        blockedWindow: notice.blockedWindow,
        timezone: notice.timezone
      });

  if (notice.upgradeConfirming) {
    return (
      <CoopNotice tone="warning" compact className="chat-quota-notice">
        <p className="coop-notice-body font-medium">Confirming upgrade…</p>
        <p className="coop-notice-body mt-1">
          Finish Stripe Checkout, then return here. This usually takes a few seconds.
        </p>
      </CoopNotice>
    );
  }

  if (paid && action === "convert-seat" && notice.nextTier && convertPhase !== "idle") {
    const fromName = notice.nextTier === "max" ? "Pro+" : "Pro";
    const copy = ownSeatConvertCopy({ fromName, toName: nextLabel });
    const processing = seatConvertProcessingCopy({ fromName, toName: nextLabel });
    if (convertPhase === "confirm") {
      return (
        <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
          <p className="coop-notice-body font-medium">{copy.title}</p>
          <p className="coop-notice-body mt-1">{copy.body}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => {
                setConvertError(null);
                setConvertPhase("processing");
                onConvertOwnSeat?.(notice.nextTier!);
              }}
            >
              {copy.confirmLabel}
            </button>
            <button type="button" className="coop-text-btn" onClick={() => setConvertPhase("idle")}>
              {copy.cancelLabel}
            </button>
          </div>
        </CoopNotice>
      );
    }
    if (convertPhase === "processing") {
      return (
        <CoopNotice tone="warning" compact className="chat-quota-notice">
          <p className="coop-notice-body font-medium">{processing.title}</p>
          <p className="coop-notice-body mt-1">{processing.body}</p>
        </CoopNotice>
      );
    }
    return (
      <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
        <p className="coop-notice-body">{convertError ?? "Could not upgrade this seat."}</p>
        <div className="mt-2">
          <button type="button" className="coop-text-btn" onClick={() => setConvertPhase("idle")}>
            Try again
          </button>
        </div>
      </CoopNotice>
    );
  }

  return (
    <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
      <p className="coop-notice-body">
        {body}{" "}
        {!paid || action === "checkout-pro" ? (
          <button type="button" className="coop-text-btn !inline !px-0 !py-0 align-baseline" onClick={onUpgradeToPro}>
            Upgrade to Pro
          </button>
        ) : action === "convert-seat" && notice.nextTier ? (
          <>
            <button
              type="button"
              className="coop-text-btn !inline !px-0 !py-0 align-baseline"
              onClick={() => setConvertPhase("confirm")}
            >
              Upgrade to {nextLabel}
            </button>
            {" — charges the card on file."}
          </>
        ) : action === "request-seat" && notice.nextTier ? (
          <>
            <button
              type="button"
              className="coop-text-btn !inline !px-0 !py-0 align-baseline"
              onClick={() => onRequestSeatUpgrade?.(notice.nextTier!)}
            >
              Request {nextLabel}
            </button>
            {" — an admin confirms before the company is charged."}
          </>
        ) : action === "enterprise-contact" ? (
          <>
            <a className="coop-text-btn !inline !px-0 !py-0 align-baseline" href={DEMO_PAGE_URL} target="_blank" rel="noreferrer">
              Contact us
            </a>
            {" about Enterprise."}
          </>
        ) : action === "none" ? (
          <span>An upgrade request is already pending.</span>
        ) : (
          <span>Upgrade is unavailable right now. Try Plan &amp; Usage in Settings.</span>
        )}
      </p>
    </CoopNotice>
  );
}
