import React from "react";
import { formatQuotaRetryClock, isPaidQuotaPool, PAID_USAGE_EXHAUSTED_COPY } from "../../chat/quotaNotice";
import { CoopNotice } from "./CoopNotice";

export type QuotaExceededNoticeState = {
  resetsAt: string;
  upgradeUrl: string;
  timezone?: string;
  message?: string;
  pool?: "paid" | "auto" | "frontier" | "free";
};

type QuotaExceededNoticeProps = {
  notice: QuotaExceededNoticeState;
  onDismiss: () => void;
};

export function QuotaExceededNotice({ notice, onDismiss }: QuotaExceededNoticeProps): React.ReactElement {
  const retryAt = formatQuotaRetryClock(notice.resetsAt, notice.timezone);
  const paid = isPaidQuotaPool(notice.pool);
  const body = notice.message?.trim()
    ? notice.message
    : paid
      ? PAID_USAGE_EXHAUSTED_COPY
      : `You've reached your free AI credits limit. Try again at ${retryAt}.`;

  return (
    <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
      <p className="coop-notice-body">
        {body}{" "}
        <a
          className="coop-text-btn !inline !px-0 !py-0 align-baseline"
          href={notice.upgradeUrl}
          target="_blank"
          rel="noreferrer"
        >
          Upgrade
        </a>
        {paid ? " for more included usage." : " for a monthly allowance."}
      </p>
    </CoopNotice>
  );
}
