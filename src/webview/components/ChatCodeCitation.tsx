import React from "react";
import { ChatCodeBlock } from "./ChatCodeBlock";

type ChatCodeCitationProps = {
  startLine: number;
  endLine: number;
  path: string;
  code: string;
  onOpenFile?: (path: string, line?: number) => void;
};

function fileNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function languageFromPath(path: string): string | undefined {
  const fileName = fileNameFromPath(path);
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

export function ChatCodeCitation({
  startLine,
  endLine,
  path,
  code,
  onOpenFile
}: ChatCodeCitationProps): React.ReactElement {
  const label = `${fileNameFromPath(path)}:${startLine}-${endLine}`;

  return (
    <section className="coop-chat-citation">
      <button
        type="button"
        className="coop-chat-citation-header coop-chat-action-link coop-chat-action-link--file"
        onClick={() => onOpenFile?.(path, startLine)}
      >
        {label}
      </button>
      <ChatCodeBlock language={languageFromPath(path)} code={code} className="coop-chat-citation-block" />
    </section>
  );
}
