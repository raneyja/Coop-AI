import React, { useMemo } from "react";
import { parseChatProse } from "../lib/chatProseParser";
import type { ChatInlineNode, ChatProseBlock } from "../lib/chatProseTypes";
import { ChatActionLink } from "./ChatActionLink";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { ChatCodeCitation } from "./ChatCodeCitation";
import { ChatJiraTicketStack } from "./ChatJiraTicketStack";
import { useChatLinks } from "./ChatLinkContext";
import { useCitationNavigation } from "./CitationNavigationContext";

import { evidenceArtifactAnchor, sourceCitationAnchor } from "../../prompts/sourceCitationRegistry";

type ChatProseProps = {
  content: string;
  relatedArtifactId?: string;
  hidePatchFences?: boolean;
  /** Growing assistant reply — lighter render + trailing caret. */
  isStreaming?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenLink?: (url: string) => void;
  className?: string;
};

type RenderOptions = {
  relatedArtifactId?: string;
  plainSourceCitations?: boolean;
  deferCodeHighlight?: boolean;
  showStreamCaret?: boolean;
};

function StreamCaret(): React.ReactElement {
  return <span className="chat-stream-caret" aria-hidden="true" />;
}

export function ChatProse({
  content,
  relatedArtifactId,
  hidePatchFences = false,
  isStreaming = false,
  onOpenFile,
  onOpenLink,
  className
}: ChatProseProps): React.ReactElement {
  const contextLinks = useChatLinks();
  const openFile = onOpenFile ?? contextLinks.onOpenFile;
  const openLink = onOpenLink ?? contextLinks.onOpenLink;
  const document = useMemo(() => parseChatProse(content), [content]);

  const visibleIndexes: number[] = [];
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index]!;
    if (hidePatchFences && shouldHidePatchBlock(block)) {
      continue;
    }
    visibleIndexes.push(index);
  }
  const lastVisibleIndex = visibleIndexes[visibleIndexes.length - 1];

  const blocks: React.ReactElement[] = [];
  let inSourcesSection = false;

  for (const index of visibleIndexes) {
    const block = document.blocks[index]!;
    if (block.type === "section-heading") {
      inSourcesSection = block.text.trim().toLowerCase() === "sources";
    }
    blocks.push(
      renderBlock(block, index, openFile, openLink, {
        relatedArtifactId,
        plainSourceCitations: inSourcesSection,
        deferCodeHighlight: isStreaming,
        showStreamCaret: isStreaming && index === lastVisibleIndex
      })
    );
  }

  return (
    <div
      className={
        className
          ? `coop-chat-prose${isStreaming ? " coop-chat-prose--streaming" : ""} ${className}`
          : `coop-chat-prose${isStreaming ? " coop-chat-prose--streaming" : ""}`
      }
    >
      {blocks}
      {isStreaming && blocks.length === 0 ? <StreamCaret /> : null}
    </div>
  );
}

export function shouldHidePatchBlock(block: ChatProseBlock): boolean {
  if (block.type === "code-fence") {
    const language = block.language?.trim().toLowerCase();
    if (language === "patch" || block.code.includes("<<<<<<< SEARCH")) {
      return true;
    }
  }
  if (block.type === "paragraph") {
    const text = block.content.map(inlineNodeToPlainText).join("").trim();
    if (/^File:\s/.test(text)) {
      return true;
    }
  }
  return false;
}

function inlineNodeToPlainText(node: ChatInlineNode): string {
  switch (node.type) {
    case "text":
    case "strong":
    case "em":
      return node.text;
    case "inline-code":
      return node.code;
    case "file-link":
    case "source-citation":
    case "evidence-link":
      return node.label;
    case "external-link":
      return node.label;
    default:
      return "";
  }
}

function renderBlock(
  block: ChatProseBlock,
  index: number,
  onOpenFile: ((path: string, line?: number) => void) | undefined,
  onOpenLink: ((url: string) => void) | undefined,
  options: RenderOptions
): React.ReactElement {
  const caret = options.showStreamCaret ? <StreamCaret /> : null;
  switch (block.type) {
    case "section-heading":
      return (
        <p
          key={`heading-${index}`}
          className={block.headingLevel === 2 ? "coop-chat-subheading" : "coop-chat-heading"}
        >
          {block.text}
          {caret}
        </p>
      );
    case "code-fence":
      return (
        <React.Fragment key={`code-${index}`}>
          <ChatCodeBlock
            language={block.language}
            code={block.code}
            deferHighlight={options.deferCodeHighlight}
          />
          {caret}
        </React.Fragment>
      );
    case "code-citation":
      return (
        <React.Fragment key={`citation-${index}`}>
          <ChatCodeCitation
            startLine={block.startLine}
            endLine={block.endLine}
            path={block.path}
            code={block.code}
            onOpenFile={onOpenFile}
          />
          {caret}
        </React.Fragment>
      );
    case "list": {
      const ordered = block.items.every((item) => item.marker === "ordered");
      const ListTag = ordered ? "ol" : "ul";
      const lastItem = block.items.length - 1;
      return (
        <ListTag key={`list-${index}`} className="coop-chat-list">
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>
              {renderInlineNodes(item.content, onOpenFile, onOpenLink, options)}
              {caret && itemIndex === lastItem ? caret : null}
            </li>
          ))}
        </ListTag>
      );
    }
    case "jira-ticket-stack":
      return (
        <React.Fragment key={`jira-${index}`}>
          <ChatJiraTicketStack tickets={block.tickets} onOpenLink={onOpenLink} />
          {caret}
        </React.Fragment>
      );
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="coop-chat-paragraph">
          {renderInlineNodes(block.content, onOpenFile, onOpenLink, options)}
          {caret}
        </p>
      );
    default:
      return (
        <p key={`unknown-${index}`} className="coop-chat-paragraph">
          {caret}
        </p>
      );
  }
}

function renderInlineNodes(
  nodes: ChatInlineNode[],
  onOpenFile: ((path: string, line?: number) => void) | undefined,
  onOpenLink: ((url: string) => void) | undefined,
  options: RenderOptions
): React.ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <React.Fragment key={`text-${index}`}>{node.text}</React.Fragment>;
      case "strong":
        return <strong key={`strong-${index}`}>{node.text}</strong>;
      case "em":
        return <em key={`em-${index}`} className="coop-chat-em">{node.text}</em>;
      case "inline-code":
        return (
          <code key={`inline-code-${index}`} className="coop-chat-inline-code">
            {node.code}
          </code>
        );
      case "file-link":
        return (
          <ChatActionLink
            key={`file-link-${index}`}
            kind="file"
            label={node.label}
            onClick={() => onOpenFile?.(node.path, node.line)}
          />
        );
      case "source-citation": {
        if (options.plainSourceCitations) {
          return (
            <span key={`source-${index}`} className="coop-result-source-cite">
              {node.label}
            </span>
          );
        }
        const anchorId = options.relatedArtifactId
          ? sourceCitationAnchor(options.relatedArtifactId, node.label)
          : node.id;
        return (
          <SourceCitationPill key={`source-${index}`} label={node.label} id={anchorId} />
        );
      }
      case "evidence-link": {
        const anchorId = options.relatedArtifactId
          ? evidenceArtifactAnchor(options.relatedArtifactId)
          : undefined;
        if (!anchorId) {
          return <span key={`evidence-link-${index}`}>{node.label}</span>;
        }
        return (
          <EvidenceCardLink key={`evidence-link-${index}`} label={node.label} id={anchorId} />
        );
      }
      case "external-link":
        return (
          <ChatActionLink
            key={`external-link-${index}`}
            kind="external"
            label={node.label}
            onClick={() => onOpenLink?.(node.url)}
          />
        );
      default:
        return null;
    }
  });
}

function SourceCitationPill({ label, id }: { label: string; id: string }): React.ReactElement {
  const { registerCitationAnchor, scrollToEvidence } = useCitationNavigation();
  return (
    <button
      type="button"
      className="coop-result-source-cite coop-result-source-cite--link"
      ref={(element) => registerCitationAnchor(id, element)}
      onClick={() => scrollToEvidence(id)}
      title={`Jump to evidence: ${label}`}
    >
      {label}
    </button>
  );
}

function EvidenceCardLink({ label, id }: { label: string; id: string }): React.ReactElement {
  const { scrollToEvidence } = useCitationNavigation();
  return (
    <button
      type="button"
      className="coop-chat-action-link coop-chat-action-link--external"
      onClick={() => scrollToEvidence(id)}
      title="Jump to Sources evidence card"
    >
      {label}
    </button>
  );
}
