import React from "react";

type ChatActionLinkProps = {
  kind: "file" | "external";
  label: string;
  onClick: () => void;
  className?: string;
};

/** Cursor-style inline actionable reference (file path or external URL). */
export function ChatActionLink({
  kind,
  label,
  onClick,
  className
}: ChatActionLinkProps): React.ReactElement {
  return (
    <button
      type="button"
      className={
        className
          ? `coop-chat-action-link coop-chat-action-link--${kind} ${className}`
          : `coop-chat-action-link coop-chat-action-link--${kind}`
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}
