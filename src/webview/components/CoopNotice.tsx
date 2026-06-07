import React from "react";

export type CoopNoticeTone = "neutral" | "info" | "warning" | "error";

export type CoopNoticeProps = {
  tone?: CoopNoticeTone;
  title?: string;
  message?: string;
  onDismiss?: () => void;
  dismissLabel?: string;
  compact?: boolean;
  className?: string;
  role?: "alert" | "status";
  children?: React.ReactNode;
};

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function coopNoticeClass(
  tone: CoopNoticeTone,
  options?: { compact?: boolean; className?: string }
): string {
  return joinClasses(
    "coop-notice",
    tone !== "neutral" ? `coop-notice--${tone}` : undefined,
    options?.compact ? "coop-notice--compact" : undefined,
    options?.className
  );
}

export function CoopNotice({
  tone = "error",
  title,
  message,
  onDismiss,
  dismissLabel = "Dismiss",
  compact = false,
  className,
  role,
  children
}: CoopNoticeProps): React.ReactElement {
  const resolvedRole = role ?? (tone === "error" ? "alert" : "status");

  return (
    <div className={coopNoticeClass(tone, { compact, className })} role={resolvedRole}>
      <div className="min-w-0 flex-1">
        {title ? <p className="coop-notice-title">{title}</p> : null}
        {message ? (
          <p className={title ? "coop-notice-body coop-notice-body--muted" : "coop-notice-body"}>{message}</p>
        ) : null}
        {children}
      </div>
      {onDismiss ? (
        <button type="button" className="coop-text-btn shrink-0" onClick={onDismiss}>
          {dismissLabel}
        </button>
      ) : null}
    </div>
  );
}
