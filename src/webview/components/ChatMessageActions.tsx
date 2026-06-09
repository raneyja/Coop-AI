import React, { useCallback } from "react";
import { formatChatMessageForCopy } from "../lib/formatChatMessageForCopy";

type ChatMessageActionsProps = {
  content: string;
  visible: boolean;
};

export function ChatMessageActions({ content, visible }: ChatMessageActionsProps): React.ReactElement {
  const handleCopy = useCallback(async () => {
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatChatMessageForCopy(content));
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  }, [content]);

  return (
    <div className="coop-chat-message-actions" aria-hidden={!visible}>
      <button
        type="button"
        className="coop-text-btn coop-chat-message-actions-copy"
        onClick={() => {
          void handleCopy();
        }}
        tabIndex={visible ? 0 : -1}
      >
        Copy message
      </button>
    </div>
  );
}
