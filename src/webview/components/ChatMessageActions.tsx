import React, { useCallback } from "react";
import { formatChatMessageForCopy } from "../lib/formatChatMessageForCopy";

type ChatMessageActionsProps = {
  content: string;
  sourceCitationMode?: "explicit";
  visible: boolean;
};

export function ChatMessageActions({ content, visible, sourceCitationMode }: ChatMessageActionsProps): React.ReactElement {
  const handleCopy = useCallback(async () => {
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatChatMessageForCopy(content, { sourceCitationMode }));
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  }, [content, sourceCitationMode]);

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
