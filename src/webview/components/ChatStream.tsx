import React from "react";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
};

type ChatStreamProps = {
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
  endRef: React.RefObject<HTMLDivElement | null>;
  renderBody: (content: string) => React.ReactElement[];
};

function inferLinks(content: string): Array<{ label: string; url: string }> {
  const matches = content.match(/https?:\/\/[^\s)]+/g) || [];
  return matches.map((url, idx) => ({ label: `Link ${idx + 1}`, url }));
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  message,
  renderBody
}: {
  message: ChatMessage;
  renderBody: (content: string) => React.ReactElement[];
}): React.ReactElement {
  const isUser = message.role === "user";
  const links = message.links || inferLinks(message.content);

  return (
    <article className={`flex w-full min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          max-w-[92%] min-w-0 rounded-lg px-3 py-2.5 text-sm
          ${isUser
            ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]"
            : "border border-[var(--vscode-widget-border,var(--vscode-panel-border))] bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]"
          }
        `}
      >
        {!isUser ? (
          <div className="mb-1 text-[10px] font-medium text-[var(--vscode-descriptionForeground)]">Coop</div>
        ) : null}
        <div className="min-w-0 break-words leading-relaxed">{renderBody(message.content)}</div>
        {links.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                className="text-xs underline text-[var(--vscode-textLink-foreground)]"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
        <time className="mt-1 block text-[10px] opacity-50">{formatTime(message.timestamp)}</time>
      </div>
    </article>
  );
}

export function ChatStream({ messages, streamingMessage, endRef, renderBody }: ChatStreamProps): React.ReactElement {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3" role="log" aria-live="polite">
      {messages.map((message, index) => (
        <MessageBubble key={`${message.timestamp}-${index}`} message={message} renderBody={renderBody} />
      ))}

      {streamingMessage ? (
        <article className="flex w-full min-w-0 justify-start">
          <div
            className="max-w-[92%] min-w-0 rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] px-3 py-2.5"
          >
            <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--vscode-descriptionForeground)]">
              <span>Coop</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--vscode-progressBar-background)]" />
                thinking…
              </span>
            </div>
            <div className="min-w-0 break-words text-sm">{renderBody(streamingMessage.content)}</div>
          </div>
        </article>
      ) : null}

      <div ref={endRef} className="h-px shrink-0" />
    </div>
  );
}
