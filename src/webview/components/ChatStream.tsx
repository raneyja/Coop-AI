import React, { useEffect, useRef } from "react";
import type { ChatImageAttachment } from "../../chat/types";
import { paperclipAttachmentKind } from "../../chat/paperclipAttachments";
import type { ConflictSummary } from "../types";
import type { EvidenceActionContext } from "../evidenceCardActionHandler";
import { DecisionTimeline, type DecisionTimelinePayload } from "../DecisionTimeline";
import { OwnershipCard, type OwnershipCardPayload } from "../OwnershipCard";
import {
  BlastRadiusEvidenceCard,
  IntegrationSearchEvidenceCard,
  KnowledgeGapsEvidenceCard,
  RepoSummaryEvidenceCard
} from "../EvidenceCards";
import type { IntegrationChatProvider } from "../../chat/types";
import type {
  BlastRadiusEvidence,
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  RepoSummaryEvidence,
  SlackSearchEvidence
} from "../../context/contextBundleEvidence";
import { ChatMessageActions } from "./ChatMessageActions";
import { ChatThinkingIndicator } from "./ChatThinkingIndicator";
import { EvidenceArtifactAnchor } from "./EvidenceArtifactAnchor";
import { MentionAttachmentChip } from "./MentionAttachmentChip";
import {
  parseContextLineAttachments,
  splitPlainChatHistoryBody,
  type HistoryAttachment
} from "../lib/parseHistoryAttachments";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
  relatedArtifactId?: string;
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
      slackSearch?: SlackSearchEvidence;
    }
  | {
      id: string;
      kind: "repo-summary";
      timestamp: number;
      evidence: RepoSummaryEvidence;
      owner: string;
      repo: string;
      branch?: string;
    }
  | {
      id: string;
      kind: "blast-radius";
      timestamp: number;
      evidence: BlastRadiusEvidence;
      file: string;
    }
  | {
      id: string;
      kind: "knowledge-gaps";
      timestamp: number;
      evidence: KnowledgeGapsEvidence;
      confluence?: ConfluenceSearchEvidence;
      jira?: JiraSearchEvidence;
      slack?: SlackSearchEvidence;
      notion?: NotionSearchEvidence;
      googleDocs?: GoogleDocsSearchEvidence;
      teams?: TeamsSearchEvidence;
      file?: string;
    }
  | {
      id: string;
      kind: "integration";
      timestamp: number;
      provider: IntegrationChatProvider;
      evidence: Record<string, unknown>;
    };

type ChatStreamProps = {
  messages: ChatMessage[];
  artifacts: ChatInlineArtifact[];
  streamingMessage: ChatMessage | null;
  /** Context-gathering status shown inline after the latest user turn. */
  thinkingMessage?: string;
  endRef: React.RefObject<HTMLDivElement | null>;
  renderBody: (content: string, relatedArtifactId?: string) => React.ReactElement[];
  actionContext: EvidenceActionContext;
  conflicts?: ConflictSummary[];
  /** Bumps when thread/history loads so the view jumps to the latest messages. */
  scrollEpoch?: number;
};

const SCROLL_PIN_THRESHOLD_PX = 64;

function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
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

function HistoryAttachmentChips({
  attachments
}: {
  attachments: HistoryAttachment[];
}): React.ReactElement | null {
  if (!attachments.length) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment, index) => (
        <MentionAttachmentChip
          key={`${attachment.title}-${index}`}
          basename={attachment.basename}
          isLocal={attachment.isLocal}
          title={attachment.title}
        />
      ))}
    </div>
  );
}

function PlainChatBody({
  body,
  renderBody
}: {
  body: string;
  renderBody: (content: string) => React.ReactElement[];
}): React.ReactElement {
  const { message, attachments } = splitPlainChatHistoryBody(body);
  return (
    <div className="chat-message-body">
      {message ? renderBody(message) : null}
      <HistoryAttachmentChips attachments={attachments} />
    </div>
  );
}

/** Split quick-action bubble body into intent line + optional context chip line. */
function parseQuickActionBody(body: string): { intent: string; contextLine?: string; legacyBody?: string } {
  const trimmed = body.trim();
  if (!trimmed) {
    return { intent: "" };
  }

  // Legacy bubbles: full prompt with "Context:" block — show intent only.
  const legacyContext = trimmed.indexOf("\nContext:");
  if (legacyContext > 0) {
    return {
      intent: trimmed.slice(0, legacyContext).trim(),
      legacyBody: trimmed.slice(legacyContext).trim()
    };
  }

  const newline = trimmed.indexOf("\n");
  if (newline === -1) {
    return { intent: trimmed };
  }

  const intent = trimmed.slice(0, newline).trim();
  const rest = trimmed.slice(newline + 1).trim();
  if (!rest) {
    return { intent };
  }

  // New compact format: second line is "key: value · key: value"
  if (/^[\w ]+: .+( · [\w ]+: .+)*$/.test(rest)) {
    return { intent, contextLine: rest };
  }

  return { intent: trimmed };
}

function QuickActionBody({
  body,
  renderBody
}: {
  body: string;
  renderBody: (content: string) => React.ReactElement[];
}): React.ReactElement {
  const parsed = parseQuickActionBody(body);

  if (parsed.legacyBody) {
    return (
      <div className="chat-message-body chat-message-body--quick-action">
        <p className="chat-action-intent">{parsed.intent}</p>
      </div>
    );
  }

  if (parsed.contextLine) {
    const { withoutAttachments, attachments } = parseContextLineAttachments(parsed.contextLine);
    return (
      <div className="chat-message-body chat-message-body--quick-action">
        <p className="chat-action-intent">{parsed.intent}</p>
        {withoutAttachments ? <p className="chat-action-context">{withoutAttachments}</p> : null}
        <HistoryAttachmentChips attachments={attachments} />
      </div>
    );
  }

  return <div className="chat-message-body">{renderBody(body)}</div>;
}

function MessageBlock({
  message,
  renderBody,
  isStreaming = false
}: {
  message: ChatMessage;
  renderBody: (content: string, relatedArtifactId?: string) => React.ReactElement[];
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
            {message.attachments.map((attachment) =>
              paperclipAttachmentKind(attachment.mimeType, attachment.name) === "image" ? (
                <img
                  key={attachment.id}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  title={attachment.name}
                />
              ) : (
                <span
                  key={attachment.id}
                  className="chat-message-attachment-file"
                  title={attachment.name}
                >
                  {attachment.name.split("/").pop() ?? attachment.name}
                </span>
              )
            )}
          </div>
        ) : null}

        {parsed.body ? (
          isUser && parsed.tag ? (
            <QuickActionBody body={parsed.body} renderBody={renderBody} />
          ) : isUser ? (
            <PlainChatBody body={parsed.body} renderBody={(content) => renderBody(content, message.relatedArtifactId)} />
          ) : (
            <div className="chat-message-body">{renderBody(parsed.body, message.relatedArtifactId)}</div>
          )
        ) : null}
      </div>
    </article>
  );
}

export function renderInlineArtifact(
  artifact: ChatInlineArtifact,
  _onDismiss: () => void,
  actionContext: EvidenceActionContext,
  conflicts?: ConflictSummary[]
): React.ReactElement {
  return renderArtifact(artifact, actionContext, conflicts);
}

function buildTimelineEntries(messages: ChatMessage[], artifacts: ChatInlineArtifact[]) {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const emittedArtifacts = new Set<string>();
  const entries: Array<
    | { id: string; type: "message"; timestamp: number; message: ChatMessage }
    | { id: string; type: "artifact"; timestamp: number; artifact: ChatInlineArtifact }
  > = [];

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  for (const message of sortedMessages) {
    if (message.relatedArtifactId && artifactById.has(message.relatedArtifactId)) {
      const artifact = artifactById.get(message.relatedArtifactId)!;
      if (!emittedArtifacts.has(artifact.id)) {
        entries.push({
          id: `artifact-${artifact.id}`,
          type: "artifact",
          timestamp: artifact.timestamp,
          artifact
        });
        emittedArtifacts.add(artifact.id);
      }
    }
    entries.push({
      id: `msg-${message.timestamp}-${message.content.slice(0, 12)}`,
      type: "message",
      timestamp: message.timestamp,
      message
    });
  }

  for (const artifact of [...artifacts].sort((a, b) => a.timestamp - b.timestamp)) {
    if (!emittedArtifacts.has(artifact.id)) {
      entries.push({
        id: `artifact-${artifact.id}`,
        type: "artifact",
        timestamp: artifact.timestamp,
        artifact
      });
    }
  }

  return entries;
}

function conflictsForArtifact(
  conflicts: ConflictSummary[] | undefined,
  artifact: ChatInlineArtifact
): ConflictSummary[] {
  if (!conflicts?.length) {
    return [];
  }
  const file = artifactFile(artifact);
  const repoId = artifactRepoId(artifact);
  return conflicts
    .filter((conflict) => {
      if (file && conflict.file && conflict.file === file) {
        return true;
      }
      if (repoId && conflict.repoId && conflict.repoId === repoId) {
        return true;
      }
      return !file && !repoId;
    })
    .slice(0, 2);
}

function artifactFile(artifact: ChatInlineArtifact): string | undefined {
  switch (artifact.kind) {
    case "decision":
      return artifact.timeline.file;
    case "ownership":
      return artifact.report.path;
    case "blast-radius":
      return artifact.file;
    case "knowledge-gaps":
      return artifact.file ?? artifact.evidence.file;
    default:
      return undefined;
  }
}

function artifactRepoId(artifact: ChatInlineArtifact): string | undefined {
  switch (artifact.kind) {
    case "decision":
      return `${artifact.timeline.owner}/${artifact.timeline.repo}`;
    case "ownership":
      return `${artifact.report.owner}/${artifact.report.repo}`;
    case "repo-summary":
      return `${artifact.owner}/${artifact.repo}`;
    default:
      return undefined;
  }
}

function renderArtifact(
  artifact: ChatInlineArtifact,
  actionContext: EvidenceActionContext,
  conflicts?: ConflictSummary[]
): React.ReactElement | null {
  const cardConflicts = conflictsForArtifact(conflicts, artifact);
  switch (artifact.kind) {
    case "decision":
      return (
        <DecisionTimeline
          timeline={artifact.timeline}
          artifactId={artifact.id}
          conflicts={cardConflicts}
          actionContext={actionContext}
        />
      );
    case "ownership":
      return (
        <OwnershipCard
          report={artifact.report}
          artifactId={artifact.id}
          slackSearch={artifact.slackSearch}
          conflicts={cardConflicts}
          actionContext={actionContext}
        />
      );
    case "repo-summary":
      return (
        <RepoSummaryEvidenceCard
          evidence={artifact.evidence}
          owner={artifact.owner}
          repo={artifact.repo}
          branch={artifact.branch}
          artifactId={artifact.id}
          conflicts={cardConflicts}
          actionContext={actionContext}
        />
      );
    case "blast-radius":
      return (
        <BlastRadiusEvidenceCard
          evidence={artifact.evidence}
          file={artifact.file}
          artifactId={artifact.id}
          conflicts={cardConflicts}
          actionContext={actionContext}
        />
      );
    case "knowledge-gaps":
      return (
        <KnowledgeGapsEvidenceCard
          evidence={artifact.evidence}
          confluence={artifact.confluence}
          jira={artifact.jira}
          slack={artifact.slack}
          notion={artifact.notion}
          googleDocs={artifact.googleDocs}
          teams={artifact.teams}
          file={artifact.file}
          artifactId={artifact.id}
          conflicts={cardConflicts}
          actionContext={actionContext}
        />
      );
    case "integration":
      return (
        <IntegrationSearchEvidenceCard
          provider={artifact.provider}
          evidence={artifact.evidence}
          artifactId={artifact.id}
          actionContext={actionContext}
        />
      );
  }
}

export function ChatStream({
  messages,
  artifacts,
  streamingMessage,
  thinkingMessage,
  endRef,
  renderBody,
  actionContext,
  conflicts,
  scrollEpoch = 0
}: ChatStreamProps): React.ReactElement {
  const timelineEntries = buildTimelineEntries(messages, artifacts);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);
  const prevStreamingRef = useRef(Boolean(streamingMessage));

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      pinnedToBottomRef.current = isPinnedToBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    pinnedToBottomRef.current = true;
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [scrollEpoch, endRef]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    const userJustSent =
      messages.length > prevMessageCountRef.current && lastMessage?.role === "user";
    const streamingStarted = !prevStreamingRef.current && Boolean(streamingMessage);

    prevMessageCountRef.current = messages.length;
    prevStreamingRef.current = Boolean(streamingMessage);

    if (userJustSent || streamingStarted) {
      pinnedToBottomRef.current = true;
    }

    if (pinnedToBottomRef.current) {
      endRef.current?.scrollIntoView({
        behavior: streamingMessage ? "auto" : "smooth",
        block: "end"
      });
    }
  }, [messages, artifacts, streamingMessage, thinkingMessage, endRef]);

  return (
    <div ref={scrollContainerRef} className="chat-thread no-scrollbar" role="log" aria-live="polite">
      <div className="chat-thread-messages">
        {timelineEntries.map((entry) =>
          entry.type === "message" ? (
            <MessageBlock key={entry.id} message={entry.message} renderBody={renderBody} />
          ) : (
            <article key={entry.id} className="chat-message chat-message--evidence group" data-role="evidence">
              <EvidenceArtifactAnchor artifactId={entry.artifact.id}>
                <div className="chat-message-inner">
                  <div className="chat-message-meta">
                    <span className="chat-message-label chat-message-label--evidence">Sources</span>
                    <time className="chat-message-time">{formatTime(entry.artifact.timestamp)}</time>
                  </div>
                  {renderArtifact(entry.artifact, actionContext, conflicts)}
                </div>
              </EvidenceArtifactAnchor>
            </article>
          )
        )}

        {thinkingMessage ? (
          <ChatThinkingIndicator message={thinkingMessage} />
        ) : null}

        {streamingMessage ? (
          <MessageBlock message={streamingMessage} renderBody={renderBody} isStreaming />
        ) : null}

        <div ref={endRef} className="chat-thread-anchor" />
      </div>
    </div>
  );
}
