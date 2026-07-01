"use client";

import React, { useMemo } from "react";
import { parseChatProse } from "@/lib/chatProse";
import type { ChatInlineNode, ChatProseBlock } from "@/lib/chatProse";

type FeedChatProseProps = {
  content: string;
  className?: string;
};

export function FeedChatProse({ content, className }: FeedChatProseProps): React.ReactElement {
  const blocks = useMemo(() => parseChatProse(content).blocks, [content]);

  return (
    <div className={className ? `coop-chat-prose ${className}` : "coop-chat-prose"}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: ChatProseBlock, index: number): React.ReactElement {
  switch (block.type) {
    case "section-heading":
      return (
        <p key={`heading-${index}`} className="coop-chat-heading">
          {block.text}
        </p>
      );
    case "code-fence":
      return <FeedCodeBlock key={`code-${index}`} language={block.language} code={block.code} />;
    case "code-citation":
      return (
        <FeedCodeCitation
          key={`citation-${index}`}
          startLine={block.startLine}
          endLine={block.endLine}
          path={block.path}
          code={block.code}
        />
      );
    case "list": {
      const ordered = block.items.every((item) => item.marker === "ordered");
      const ListTag = ordered ? "ol" : "ul";
      return (
        <ListTag key={`list-${index}`} className="coop-chat-list">
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>{renderInlineNodes(item.content)}</li>
          ))}
        </ListTag>
      );
    }
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="coop-chat-paragraph">
          {renderInlineNodes(block.content)}
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

function renderInlineNodes(nodes: ChatInlineNode[]): React.ReactNode[] {
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
          <span key={`file-link-${index}`} className="coop-chat-action-link coop-chat-action-link--file">
            {node.label}
          </span>
        );
      case "external-link":
        return (
          <a
            key={`external-link-${index}`}
            href={node.url}
            className="coop-chat-action-link coop-chat-action-link--external"
            target="_blank"
            rel="noreferrer"
          >
            {node.label}
          </a>
        );
      default:
        return null;
    }
  });
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function FeedCodeBlock({
  language,
  code
}: {
  language?: string;
  code: string;
}): React.ReactElement {
  const languageLabel = language?.trim() ? language.trim() : "text";

  return (
    <div className="coop-chat-code-block">
      <div className="coop-chat-code-header">
        <span className="coop-chat-code-lang">{languageLabel}</span>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function FeedCodeCitation({
  startLine,
  endLine,
  path,
  code
}: {
  startLine: number;
  endLine: number;
  path: string;
  code: string;
}): React.ReactElement {
  const label = `${fileNameFromPath(path)}:${startLine}-${endLine}`;

  return (
    <section className="coop-chat-citation">
      <div className="coop-chat-citation-header">{label}</div>
      <div className="coop-chat-citation-block">
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    </section>
  );
}
