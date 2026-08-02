import React from "react";
import { ChatCodeBlock } from "./ChatCodeBlock";

type ChatCodeCitationProps = {
  startLine: number;
  endLine: number;
  path: string;
  code: string;
  onOpenFile?: (path: string, line?: number) => void;
};

function languageFromPath(path: string): string | undefined {
  const fileName = path.split("/").filter(Boolean).pop() ?? path;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!ext) {
    return undefined;
  }
  if (ext === "ts" || ext === "tsx") {
    return "typescript";
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return "javascript";
  }
  if (ext === "py") {
    return "python";
  }
  if (ext === "json") {
    return "json";
  }
  return ext;
}

function citationLabel(path: string, startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `${path}:${startLine}`;
  }
  return `${path}:${startLine}-${endLine}`;
}

export function ChatCodeCitation({
  startLine,
  endLine,
  path,
  code,
  onOpenFile
}: ChatCodeCitationProps): React.ReactElement {
  const label = citationLabel(path, startLine, endLine);
  const hasPreview = code.trim().length > 0;

  return (
    <section className="coop-chat-citation">
      <button
        type="button"
        className="coop-chat-citation-header coop-chat-action-link coop-chat-action-link--file"
        onClick={() => onOpenFile?.(path, startLine)}
        title={`Open ${label}`}
      >
        {label}
      </button>
      {hasPreview ? (
        <ChatCodeBlock
          language={languageFromPath(path)}
          code={code}
          className="coop-chat-citation-block"
          hideLanguage
        />
      ) : null}
    </section>
  );
}
