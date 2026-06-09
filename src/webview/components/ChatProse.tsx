import React, { useMemo } from "react";
import { parseChatProse } from "../lib/chatProseParser";
import type { ChatInlineNode, ChatProseBlock } from "../lib/chatProseTypes";
import { ChatActionLink } from "./ChatActionLink";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { ChatCodeCitation } from "./ChatCodeCitation";
import { ChatJiraTicketStack } from "./ChatJiraTicketStack";
import { useChatLinks } from "./ChatLinkContext";

type ChatProseProps = {
  content: string;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenLink?: (url: string) => void;
  className?: string;
};

export function ChatProse({
  content,
  onOpenFile,
  onOpenLink,
  className
}: ChatProseProps): React.ReactElement {
  const contextLinks = useChatLinks();
  const openFile = onOpenFile ?? contextLinks.onOpenFile;
  const openLink = onOpenLink ?? contextLinks.onOpenLink;
  const document = useMemo(() => parseChatProse(content), [content]);

  return (
    <div className={className ? `coop-chat-prose ${className}` : "coop-chat-prose"}>
      {document.blocks.map((block, index) => renderBlock(block, index, openFile, openLink))}
    </div>
  );
}

function renderBlock(
  block: ChatProseBlock,
  index: number,
  onOpenFile?: (path: string, line?: number) => void,
  onOpenLink?: (url: string) => void
): React.ReactElement {
  switch (block.type) {
    case "section-heading":
      return (
        <p
          key={`heading-${index}`}
          className={block.headingLevel === 2 ? "coop-chat-subheading" : "coop-chat-heading"}
        >
          {block.text}
        </p>
      );
    case "code-fence":
      return (
        <ChatCodeBlock key={`code-${index}`} language={block.language} code={block.code} />
      );
    case "code-citation":
      return (
        <ChatCodeCitation
          key={`citation-${index}`}
          startLine={block.startLine}
          endLine={block.endLine}
          path={block.path}
          code={block.code}
          onOpenFile={onOpenFile}
        />
      );
    case "list": {
      const ordered = block.items.every((item) => item.marker === "ordered");
      const ListTag = ordered ? "ol" : "ul";
      return (
        <ListTag key={`list-${index}`} className="coop-chat-list">
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>
              {renderInlineNodes(item.content, onOpenFile, onOpenLink)}
            </li>
          ))}
        </ListTag>
      );
    }
    case "jira-ticket-stack":
      return (
        <ChatJiraTicketStack
          key={`jira-${index}`}
          tickets={block.tickets}
          onOpenLink={onOpenLink}
        />
      );
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="coop-chat-paragraph">
          {renderInlineNodes(block.content, onOpenFile, onOpenLink)}
        </p>
      );
    default:
      return (
        <p key={`unknown-${index}`} className="coop-chat-paragraph">
          {""}
        </p>
      );
  }
}

function renderInlineNodes(
  nodes: ChatInlineNode[],
  onOpenFile?: (path: string, line?: number) => void,
  onOpenLink?: (url: string) => void
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
