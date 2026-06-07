import React, { useMemo } from "react";
import { parseChatProse } from "../lib/chatProseParser";
import type { ChatInlineNode, ChatProseBlock } from "../lib/chatProseTypes";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { ChatCodeCitation } from "./ChatCodeCitation";
import { ChatJiraTicketStack } from "./ChatJiraTicketStack";

type ChatProseProps = {
  content: string;
  onOpenFile?: (path: string, line?: number) => void;
  className?: string;
};

export function ChatProse({ content, onOpenFile, className }: ChatProseProps): React.ReactElement {
  const document = useMemo(() => parseChatProse(content), [content]);

  return (
    <div className={className ? `coop-chat-prose ${className}` : "coop-chat-prose"}>
      {document.blocks.map((block, index) => renderBlock(block, index, onOpenFile))}
    </div>
  );
}

function renderBlock(
  block: ChatProseBlock,
  index: number,
  onOpenFile?: (path: string, line?: number) => void
): React.ReactElement {
  switch (block.type) {
    case "section-heading":
      return (
        <p key={`heading-${index}`} className="coop-chat-heading">
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
            <li key={`list-${index}-${itemIndex}`}>{renderInlineNodes(item.content, onOpenFile)}</li>
          ))}
        </ListTag>
      );
    }
    case "jira-ticket-stack":
      return <ChatJiraTicketStack key={`jira-${index}`} tickets={block.tickets} />;
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="coop-chat-paragraph">
          {renderInlineNodes(block.content, onOpenFile)}
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
  onOpenFile?: (path: string, line?: number) => void
): React.ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <React.Fragment key={`text-${index}`}>{node.text}</React.Fragment>;
      case "strong":
        return <strong key={`strong-${index}`}>{node.text}</strong>;
      case "inline-code":
        return (
          <code key={`inline-code-${index}`} className="coop-chat-inline-code">
            {node.code}
          </code>
        );
      case "file-link":
        return (
          <button
            key={`file-link-${index}`}
            type="button"
            className="coop-chat-file-link"
            onClick={() => onOpenFile?.(node.path, node.line)}
          >
            {node.label}
          </button>
        );
      case "external-link":
        return (
          <a key={`external-link-${index}`} href={node.url} target="_blank" rel="noreferrer">
            {node.label}
          </a>
        );
      default:
        return null;
    }
  });
}
