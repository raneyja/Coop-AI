import React from "react";
import { formatQuotaRetryClock } from "../../chat/quotaNotice";
import { CoopNotice } from "./CoopNotice";

export type QuotaExceededNoticeState = {
  resetsAt: string;
  upgradeUrl: string;
  timezone?: string;
};

type QuotaExceededNoticeProps = {
  notice: QuotaExceededNoticeState;
  onDismiss: () => void;
};

export function QuotaExceededNotice({ notice, onDismiss }: QuotaExceededNoticeProps): React.ReactElement {
  const retryAt = formatQuotaRetryClock(notice.resetsAt, notice.timezone);

  return (
    <CoopNotice tone="warning" compact onDismiss={onDismiss} className="chat-quota-notice">
      <p className="coop-notice-body">
        You&apos;ve reached your free AI credits limit. Try again at {retryAt} or{" "}
        <a
          className="coop-text-btn !inline !px-0 !py-0 align-baseline"
          href={notice.upgradeUrl}
          target="_blank"
          rel="noreferrer"
        >
          Upgrade to Pro
        </a>{" "}
        for unlimited usage.
      </p>
    </CoopNotice>
  );
}
