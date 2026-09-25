import React from "react";
import {
  formatFreeAllowanceCopy,
  isPaidQuotaPool,
  PAID_USAGE_EXHAUSTED_COPY
} from "../../chat/quotaNotice";
import { CoopNotice } from "./CoopNotice";

export type QuotaExceededNoticeState = {
  resetsAt: string;
  upgradeUrl: string;
  timezone?: string;
  message?: string;
  pool?: "paid" | "auto" | "frontier" | "free";
  blockedWindow?: "cycle" | "week";
};

type QuotaExceededNoticeProps = {
  notice: QuotaExceededNoticeState;
  onDismiss: () => void;
  onUpgradeToPro?: () => void;
};

export function QuotaExceededNotice({
  notice,
  onDismiss,
  onUpgradeToPro
}: QuotaExceededNoticeProps): React.ReactElement {
  const paid = isPaidQuotaPool(notice.pool);
  const body = paid
    ? notice.message?.trim() || PAID_USAGE_EXHAUSTED_COPY
    : formatFreeAllowanceCopy({
        resetsAt: notice.resetsAt,
        blockedWindow: notice.blockedWindow,
        timezone: notice.timezone
      });

  return (
    <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
      <p className="coop-notice-body">
        {body}{" "}
        {paid ? (
          <>
            <a
              className="coop-text-btn !inline !px-0 !py-0 align-baseline"
              href={notice.upgradeUrl}
              target="_blank"
              rel="noreferrer"
            >
              Upgrade
            </a>
            {" for more included usage."}
          </>
        ) : (
          <button type="button" className="coop-text-btn !inline !px-0 !py-0 align-baseline" onClick={onUpgradeToPro}>
            Upgrade to Pro
          </button>
        )}
      </p>
    </CoopNotice>
  );
}
