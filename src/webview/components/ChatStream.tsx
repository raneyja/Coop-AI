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
import { CHAT_STOPPED_MESSAGE } from "../../chat/chatStopped";
import type {
  BlastRadiusEvidence,
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  RepoSummaryEvidence,
  SlackSearchEvidence,
  TeamsSearchEvidence
} from "../../context/contextBundleEvidence";
import { ChatMessageActions } from "./ChatMessageActions";
import { ChatThinkingIndicator } from "./ChatThinkingIndicator";
import { AgentActivityPanel } from "./AgentActivityPanel";
import type { AgentActivityState } from "../agentActivity";
import type { NarrativeStep } from "../agentNarrative";
import { EvidenceArtifactAnchor } from "./EvidenceArtifactAnchor";
import { MentionAttachmentChip } from "./MentionAttachmentChip";
import {
  parseContextLineAttachments,
  splitPlainChatHistoryBody,
  type HistoryAttachment
} from "../lib/parseHistoryAttachments";
import { buildTimelineEntries } from "./chatTimelineEntries";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
  relatedArtifactId?: string;
  suggest?: import("../../chat/types").ChatSuggestPayload;
};

export type ChatInlineArtifact =
  | {
      id: string;
      kind: "decision";
      timestamp: number;
      timeline: DecisionTimelinePayload;
      codeHost?: string;
    }
  | {
      id: string;
      kind: "ownership";
      timestamp: number;
      report: OwnershipCardPayload;
      slackSearch?: SlackSearchEvidence;
      codeHost?: string;
    }
  | {
      id: string;
      kind: "repo-summary";
      timestamp: number;
      evidence: RepoSummaryEvidence;
      owner: string;
      repo: string;
      branch?: string;
      codeHost?: string;
    }
  | {
      id: string;
      kind: "blast-radius";
      timestamp: number;
      evidence: BlastRadiusEvidence;
      file: string;
      codeHost?: string;
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
      codeHost?: string;
    }
  | {
      id: string;
      kind: "integration";
      timestamp: number;
      provider: IntegrationChatProvider;
      evidence: Record<string, unknown>;
    };

type ChatSuggestResolveChoice =
  | { choice: "plain" }
  | { choice: "action"; actionId: string };

type ChatStreamProps = {
  messages: ChatMessage[];
  artifacts: ChatInlineArtifact[];
  streamingMessage: ChatMessage | null;
  /** Context-gathering status shown inline after the latest user turn. */
  thinkingMessage?: string;
  /** Progressive agent activity steps (preferred over single thinkingMessage when present). */
  narrativeSteps?: NarrativeStep[];
  /** Cursor-like todos / tools / files + thinking. */
  agentActivity?: AgentActivityState;
  showAgentActivity?: boolean;
  /** Live-only model thinking text (not persisted). */
  modelThinkingText?: string;
  modelThinkingStreaming?: boolean;
  onStopStreaming?: () => void;
  endRef: React.RefObject<HTMLDivElement | null>;
  renderBody: (content: string, relatedArtifactId?: string, messageTimestamp?: number) => React.ReactElement[];
  actionContext: EvidenceActionContext;
  conflicts?: ConflictSummary[];
  /** Bumps when thread/history loads so the view jumps to the latest messages. */
  scrollEpoch?: number;
  /** Resolve a clarifying quick-action suggest chip. */
  onSuggestResolve?: (choice: ChatSuggestResolveChoice) => void;
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
  const { message, contextLine, attachments } = splitPlainChatHistoryBody(body);
  return (
    <div className="chat-message-body">
      {message ? renderBody(message) : null}
      {contextLine ? <p className="chat-action-context">{contextLine}</p> : null}
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

function SuggestClarifyingBody({ content }: { content: string }): React.ReactElement {
  // Highlight quick-action product names so they read like slash/QA chrome.
  const parts = content.split(
    /(Find Owner|Trace Decision|Blast Radius|Understand Repo|Knowledge Gaps)/g
  );
  return (
    <p className="coop-suggest-clarifying m-0">
      {parts.map((part, index) =>
        /^(Find Owner|Trace Decision|Blast Radius|Understand Repo|Knowledge Gaps)$/.test(part) ? (
          <span key={`${part}-${index}`} className="coop-suggest-action-name">
            {part}
          </span>
        ) : (
          <React.Fragment key={`t-${index}`}>{part}</React.Fragment>
        )
      )}
    </p>
  );
}

function SuggestChipRow({
  message,
  onSuggestResolve
}: {
  message: ChatMessage;
  onSuggestResolve?: (choice: ChatSuggestResolveChoice) => void;
}): React.ReactElement | null {
  const suggest = message.suggest;
  if (!suggest?.chips.length || suggest.resolved) {
    return null;
  }

  return (
    <div className="coop-suggest-chip-row" role="group" aria-label="Suggested workflows">
      {suggest.chips.map((chip) => {
        const key = chip.kind === "plain" ? "plain" : `action-${chip.actionId ?? chip.label}`;
        const isPrimary = chip.kind === "quick-action";
        return (
          <button
            key={key}
            type="button"
            className={
              isPrimary
                ? "coop-settings-action-btn coop-suggest-chip coop-suggest-chip--primary"
                : "coop-text-btn coop-suggest-chip coop-suggest-chip--plain"
            }
            disabled={!onSuggestResolve}
            onClick={() => {
              if (!onSuggestResolve) {
                return;
              }
              if (chip.kind === "plain") {
                onSuggestResolve({ choice: "plain" });
                return;
              }
              if (chip.actionId) {
                onSuggestResolve({ choice: "action", actionId: chip.actionId });
              }
            }}
          >
            {chip.kind === "quick-action" ? (
              <span className="coop-suggest-chip-label">
                <span className="coop-suggest-chip-run">Run </span>
                <span className="coop-suggest-action-name">
                  {chip.label.replace(/^Run\s+/i, "")}
                </span>
              </span>
            ) : (
              chip.label
            )}
          </button>
        );
      })}
    </div>
  );
}

function MessageBlock({
  message,
  renderBody,
  isStreaming = false,
  onSuggestResolve
}: {
  message: ChatMessage;
  renderBody: (content: string, relatedArtifactId?: string, messageTimestamp?: number) => React.ReactElement[];
  isStreaming?: boolean;
  onSuggestResolve?: (choice: ChatSuggestResolveChoice) => void;
}): React.ReactElement {
  const isUser = message.role === "user";
  const parsed = isUser ? parseQuickActionTag(message.content) : { body: message.content };
  const isStoppedNotice =
    !isUser && !isStreaming && message.content.trim() === CHAT_STOPPED_MESSAGE;

  return (
    <article
      className={`chat-message ${isUser ? "chat-message--user" : "chat-message--assistant group"}${isStreaming ? " chat-message--streaming" : ""}${isStoppedNotice ? " chat-message--stopped" : ""}`}
      data-role={message.role}
    >
      <div className="chat-message-inner">
        {isUser && parsed.tag ? (
          <div className="chat-message-meta">
            <span className="chat-action-tag">{humanizeActionTag(parsed.tag)}</span>
            <time className="chat-message-time">{formatTime(message.timestamp)}</time>
          </div>
        ) : !isUser && !isStoppedNotice ? (
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
        ) : isUser ? (
          <time className="chat-message-time chat-message-time--solo">{formatTime(message.timestamp)}</time>
        ) : null}

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

        {isStoppedNotice ? (
          <p className="chat-message-stopped">{CHAT_STOPPED_MESSAGE}</p>
        ) : parsed.body ? (
          isUser && parsed.tag ? (
            <QuickActionBody body={parsed.body} renderBody={renderBody} />
          ) : isUser ? (
            <PlainChatBody body={parsed.body} renderBody={(content) => renderBody(content, message.relatedArtifactId)} />
          ) : message.suggest ? (
            <div className="chat-message-body">
              <SuggestClarifyingBody content={parsed.body} />
              <SuggestChipRow message={message} onSuggestResolve={onSuggestResolve} />
            </div>
          ) : (
            <div className="chat-message-body">
              {renderBody(parsed.body, message.relatedArtifactId, message.timestamp)}
              <SuggestChipRow message={message} onSuggestResolve={onSuggestResolve} />
            </div>
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
): React.ReactElement | null {
  return renderArtifact(artifact, actionContext, conflicts);
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
          codeHost={artifact.codeHost ?? artifact.timeline.provider}
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
          codeHost={artifact.codeHost ?? artifact.report.provider}
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
          codeHost={artifact.codeHost}
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
          codeHost={artifact.codeHost}
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
          codeHost={artifact.codeHost}
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
  narrativeSteps,
  agentActivity,
  showAgentActivity,
  modelThinkingText,
  modelThinkingStreaming,
  onStopStreaming,
  endRef,
  renderBody,
  actionContext,
  conflicts,
  scrollEpoch = 0,
  onSuggestResolve
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
        behavior: streamingMessage || modelThinkingStreaming ? "auto" : "smooth",
        block: "end"
      });
    }
  }, [
    messages,
    artifacts,
    streamingMessage,
    thinkingMessage,
    narrativeSteps,
    agentActivity,
    showAgentActivity,
    modelThinkingText,
    modelThinkingStreaming,
    endRef
  ]);

  const showWorkingStack = Boolean(showAgentActivity) || Boolean(thinkingMessage) || Boolean(modelThinkingText);

  return (
    <div ref={scrollContainerRef} className="chat-thread no-scrollbar" role="log" aria-live="polite">
      <div className="chat-thread-messages">
        {timelineEntries.map((entry) =>
          entry.type === "message" ? (
            <MessageBlock
              key={entry.id}
              message={entry.message}
              renderBody={renderBody}
              onSuggestResolve={onSuggestResolve}
            />
          ) : (
            (() => {
              const body = renderArtifact(entry.artifact, actionContext, conflicts);
              if (!body) {
                return null;
              }
              return (
                <article key={entry.id} className="chat-message chat-message--evidence group" data-role="evidence">
                  <EvidenceArtifactAnchor artifactId={entry.artifact.id}>
                    <div className="chat-message-inner">
                      <div className="chat-message-meta">
                        <span className="chat-message-label chat-message-label--evidence">Sources</span>
                        <time className="chat-message-time">{formatTime(entry.artifact.timestamp)}</time>
                      </div>
                      {body}
                    </div>
                  </EvidenceArtifactAnchor>
                </article>
              );
            })()
          )
        )}

        {showWorkingStack ? (
          <div className="chat-working-stack">
            {showAgentActivity && agentActivity ? (
              <AgentActivityPanel
                todos={agentActivity.todos}
                tools={agentActivity.tools}
                files={agentActivity.files}
                thinkingText={modelThinkingText}
                thinkingStreaming={modelThinkingStreaming}
                fallbackStatus={!agentActivity.todos.length ? thinkingMessage : undefined}
                onStop={onStopStreaming}
              />
            ) : thinkingMessage ? (
              <ChatThinkingIndicator message={thinkingMessage} />
            ) : modelThinkingText ? (
              <AgentActivityPanel
                todos={[]}
                tools={[]}
                files={[]}
                thinkingText={modelThinkingText}
                thinkingStreaming={modelThinkingStreaming}
                onStop={onStopStreaming}
              />
            ) : null}
          </div>
        ) : null}

        {streamingMessage ? (
          <MessageBlock message={streamingMessage} renderBody={renderBody} isStreaming />
        ) : null}

        <div ref={endRef} className="chat-thread-anchor" />
      </div>
    </div>
  );
}
