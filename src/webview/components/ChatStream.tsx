import React from "react";
import type { ChatImageAttachment } from "../../chat/types";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
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

function parseQuickActionTag(content: string): { tag?: string; body: string } {
  const match = content.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  if (!match) {
    return { body: content };
  }
  return { tag: match[1], body: match[2].trim() || content };
}

function humanizeActionTag(tag: string): string {
  return tag
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function MessageBlock({
  message,
  renderBody
}: {
  message: ChatMessage;
  renderBody: (content: string) => React.ReactElement[];
}): React.ReactElement {
  const isUser = message.role === "user";
  const links = message.links || inferLinks(message.content);
  const parsed = isUser ? parseQuickActionTag(message.content) : { body: message.content };

  return (
    <article
      className={`chat-message ${isUser ? "chat-message--user" : "chat-message--assistant"}`}
      data-role={message.role}
    >
      <div className="chat-message-inner">
        {isUser && parsed.tag ? (
          <div className="chat-message-meta">
            <span className="chat-action-tag">{humanizeActionTag(parsed.tag)}</span>
            <time className="chat-message-time">{formatTime(message.timestamp)}</time>
          </div>
        ) : !isUser ? (
          <div className="chat-message-meta">
            <span className="chat-message-label">CoopAI</span>
            <time className="chat-message-time">{formatTime(message.timestamp)}</time>
          </div>
        ) : (
          <time className="chat-message-time chat-message-time--solo">{formatTime(message.timestamp)}</time>
        )}

        {message.attachments?.length ? (
          <div className="chat-message-attachments">
            {message.attachments.map((attachment) => (
              <img
                key={attachment.id}
                src={attachment.dataUrl}
                alt={attachment.name}
                title={attachment.name}
              />
            ))}
          </div>
        ) : null}

        {parsed.body ? (
          <div className="chat-message-body">{renderBody(parsed.body)}</div>
        ) : null}

        {links.length > 0 ? (
          <div className="chat-message-links">
            {links.map((link) => (
              <a key={link.url} href={link.url}>
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ChatStream({ messages, streamingMessage, endRef, renderBody }: ChatStreamProps): React.ReactElement {
  return (
    <div className="chat-thread no-scrollbar" role="log" aria-live="polite">
      <div className="chat-thread-messages">
        {messages.map((message, index) => (
          <MessageBlock key={`${message.timestamp}-${index}`} message={message} renderBody={renderBody} />
        ))}

        {streamingMessage ? (
          <article className="chat-message chat-message--assistant chat-message--streaming">
            <div className="chat-message-inner">
              <div className="chat-message-meta">
                <span className="chat-message-label">CoopAI</span>
                <span className="chat-streaming-indicator" aria-hidden="true">
                  <span className="chat-streaming-dot" />
                  <span className="chat-streaming-dot" />
                  <span className="chat-streaming-dot" />
                </span>
              </div>
              <div className="chat-message-body">{renderBody(streamingMessage.content)}</div>
            </div>
          </article>
        ) : null}

        <div ref={endRef} className="chat-thread-anchor" />
      </div>
    </div>
  );
}
