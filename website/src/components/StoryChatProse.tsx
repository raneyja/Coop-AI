"use client";

import React, { useMemo } from "react";
import { parseChatProse } from "@/lib/chatProseParser";
import type { ChatInlineNode, ChatProseBlock } from "@/lib/chatProseTypes";

type StoryChatProseProps = {
  content: string;
  visibleCount?: number;
  streaming?: boolean;
  className?: string;
};

export function StoryChatProse({
  content,
  visibleCount,
  streaming = false,
  className = ""
}: StoryChatProseProps): React.ReactElement {
  const blocks = useMemo(() => parseChatProse(content).blocks, [content]);
  const visibleBlocks =
    visibleCount === undefined ? blocks : blocks.slice(0, Math.min(visibleCount, blocks.length));
  const showCursor = streaming && (visibleCount ?? blocks.length) < blocks.length;

  return (
    <div className={`story-chat-prose ${className}`.trim()}>
      {visibleBlocks.map((block, index) => (
        <div key={`block-${index}`} className="story-text-in">
          {renderBlock(block, index)}
        </div>
      ))}
      {showCursor ? (
        <span className="story-cursor inline-block h-4 w-0.5 translate-y-[2px] bg-coop-index" aria-hidden />
      ) : null}
    </div>
  );
}

function renderBlock(block: ChatProseBlock, index: number): React.ReactElement {
  switch (block.type) {
    case "section-heading":
      return (
        <p key={`heading-${index}`} className="story-chat-heading">
          {block.text}
        </p>
      );
    case "code-fence":
      return <StoryCodeBlock key={`code-${index}`} language={block.language} code={block.code} />;
    case "code-citation":
      return (
        <StoryCodeCitation
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
        <ListTag key={`list-${index}`} className="story-chat-list">
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>{renderInlineNodes(item.content)}</li>
          ))}
        </ListTag>
      );
    }
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="story-chat-paragraph">
          {renderInlineNodes(block.content)}
        </p>
      );
    default:
      return (
        <p key={`unknown-${index}`} className="story-chat-paragraph">
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
          <code key={`inline-code-${index}`} className="story-chat-inline-code">
            {node.code}
          </code>
        );
      case "file-link":
        return (
          <span key={`file-link-${index}`} className="story-chat-file-link">
            {node.label}
          </span>
        );
      case "external-link":
        return (
          <a
            key={`external-link-${index}`}
            href={node.url}
            className="story-chat-external-link"
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

function StoryCodeBlock({
  language,
  code,
  className = ""
}: {
  language?: string;
  code: string;
  className?: string;
}): React.ReactElement {
  const languageLabel = language?.trim() || undefined;

  return (
    <div className={`story-chat-code-block ${className}`.trim()} data-code-surface="anonymous">
      <div className="story-chat-code-header">
        {languageLabel ? <span className="story-chat-code-lang">{languageLabel}</span> : null}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StoryCodeCitation({
  startLine,
  endLine,
  path,
  code
}: {
  startLine?: number;
  endLine?: number;
  path: string;
  code: string;
}): React.ReactElement {
  const label =
    startLine == null
      ? path
      : endLine == null || endLine === startLine
        ? `${path}:${startLine}`
        : `${path}:${startLine}-${endLine}`;

  return (
    <section className="story-chat-citation" data-code-surface="cite">
      <div className="story-chat-citation-header">{label}</div>
      {code.trim() ? (
        <div className="story-chat-citation-block">
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}
