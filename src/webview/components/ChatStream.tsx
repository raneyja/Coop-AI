import React from "react";
import type { ChatImageAttachment } from "../../chat/types";
import { DecisionTimeline, type DecisionTimelinePayload } from "../DecisionTimeline";
import { OwnershipCard, type OwnershipCardPayload } from "../OwnershipCard";
import { ChatMessageActions } from "./ChatMessageActions";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
};

export type ChatInlineArtifact =
  | {
      id: string;
      kind: "decision";
      timestamp: number;
      timeline: DecisionTimelinePayload;
    }
  | {
      id: string;
      kind: "ownership";
      timestamp: number;
      report: OwnershipCardPayload;
    };

type ChatStreamProps = {
  messages: ChatMessage[];
  artifacts: ChatInlineArtifact[];
  streamingMessage: ChatMessage | null;
  endRef: React.RefObject<HTMLDivElement | null>;
  renderBody: (content: string) => React.ReactElement[];
  onDismissArtifact: (id: string) => void;
  onCopyOwnershipDraft: (text: string) => void;
};

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
  renderBody,
  isStreaming = false
}: {
  message: ChatMessage;
  renderBody: (content: string) => React.ReactElement[];
  isStreaming?: boolean;
}): React.ReactElement {
  const isUser = message.role === "user";
  const parsed = isUser ? parseQuickActionTag(message.content) : { body: message.content };

  return (
    <article
      className={`chat-message ${isUser ? "chat-message--user" : "chat-message--assistant group"}${isStreaming ? " chat-message--streaming" : ""}`}
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
            {isStreaming ? (
              <span className="chat-streaming-indicator" aria-hidden="true">
                <span className="chat-streaming-dot" />
                <span className="chat-streaming-dot" />
                <span className="chat-streaming-dot" />
              </span>
            ) : null}
            <time className="chat-message-time">{formatTime(message.timestamp)}</time>
            <ChatMessageActions content={message.content} visible={Boolean(message.content)} />
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
      </div>
    </article>
  );
}

export function ChatStream({
  messages,
  artifacts,
  streamingMessage,
  endRef,
  renderBody,
  onDismissArtifact,
  onCopyOwnershipDraft
}: ChatStreamProps): React.ReactElement {
  const timelineEntries = [
    ...messages.map((message, index) => ({
      id: `msg-${message.timestamp}-${index}`,
      type: "message" as const,
      timestamp: message.timestamp,
      message
    })),
    ...artifacts.map((artifact) => ({
      id: `artifact-${artifact.id}`,
      type: "artifact" as const,
      timestamp: artifact.timestamp,
      artifact
    }))
  ].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="chat-thread no-scrollbar" role="log" aria-live="polite">
      <div className="chat-thread-messages">
        {timelineEntries.map((entry) =>
          entry.type === "message" ? (
            <MessageBlock key={entry.id} message={entry.message} renderBody={renderBody} />
          ) : (
            <article key={entry.id} className="chat-message chat-message--assistant group" data-role="assistant">
              <div className="chat-message-inner">
                <div className="chat-message-meta">
                  <span className="chat-message-label">CoopAI</span>
                  <time className="chat-message-time">{formatTime(entry.artifact.timestamp)}</time>
                </div>
                {entry.artifact.kind === "decision" ? (
                  <DecisionTimeline
                    timeline={entry.artifact.timeline}
                    onDismiss={() => onDismissArtifact(entry.artifact.id)}
                  />
                ) : (
                  <OwnershipCard
                    report={entry.artifact.report}
                    onDismiss={() => onDismissArtifact(entry.artifact.id)}
                    onCopyDraft={onCopyOwnershipDraft}
                  />
                )}
              </div>
            </article>
          )
        )}

        {streamingMessage ? (
          <MessageBlock message={streamingMessage} renderBody={renderBody} isStreaming />
        ) : null}

        <div ref={endRef} className="chat-thread-anchor" />
      </div>
    </div>
  );
}
