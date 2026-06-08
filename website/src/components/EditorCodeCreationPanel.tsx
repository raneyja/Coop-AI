"use client";

import type { CodeCreationStory, CodeEditorLine, CompleteStory, EditStory } from "@/lib/codeCreationScenarios";
import type { CodeToken } from "@/lib/productMockScenarios";

const TOKEN_COLOR: Record<CodeToken["t"], string> = {
  keyword: "text-[#569cd6]",
  fn: "text-[#dcdcaa]",
  type: "text-[#4ec9b0]",
  string: "text-[#ce9178]",
  comment: "text-[#6a9955]",
  plain: "text-[#d4d4d4]"
};

export type CompletePhase = "idle" | "ghost" | "accepted" | "hold";
export type EditPhase = "idle" | "select" | "prompt" | "diff" | "hold";

type EditorCodeCreationPanelProps = {
  story: CodeCreationStory;
  completePhase?: CompletePhase;
  editPhase?: EditPhase;
  ghostVisibleChars?: number;
  /** When true, render editor body only (no window chrome) for split demo layout */
  embedded?: boolean;
  className?: string;
};

export function EditorCodeCreationPanel({
  story,
  completePhase = "accepted",
  editPhase = "diff",
  ghostVisibleChars,
  embedded = false,
  className = ""
}: EditorCodeCreationPanelProps) {
  const body = (
    <EditorCodeBody
      story={story}
      completePhase={completePhase}
      editPhase={editPhase}
      ghostVisibleChars={ghostVisibleChars}
    />
  );

  if (embedded) {
    return (
      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e] p-3 font-mono text-[11px] leading-[1.55] md:p-4 ${className}`.trim()}
        role="img"
        aria-label={story.ariaLabel}
      >
        {body}
      </div>
    );
  }

  const inactiveTab =
    story.inactiveTab ?? (story.kind === "complete" ? "session_store.go" : "token_validator.ts");

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col bg-[#1e1e1e] ${className}`.trim()}
      role="img"
      aria-label={story.ariaLabel}
    >
      <div className="flex items-center gap-3 border-b border-[#2a2a2a] bg-[#252526] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[11px] text-coop-muted">
          <span className="rounded-t bg-[#1e1e1e] px-2.5 py-1 text-white/85">{story.activeTab}</span>
          <span className="px-2 py-1 opacity-40">{inactiveTab}</span>
        </div>
        <span className="font-mono text-[10px] text-coop-index">{story.feature}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-3 font-mono text-[11px] leading-[1.55] md:p-4">
        {body}
      </div>
    </div>
  );
}

function EditorCodeBody({
  story,
  completePhase,
  editPhase,
  ghostVisibleChars
}: {
  story: CodeCreationStory;
  completePhase: CompletePhase;
  editPhase: EditPhase;
  ghostVisibleChars?: number;
}) {
  return (
    <>
      {story.kind === "edit" && editPhase !== "idle" && editPhase !== "select" ? (
        <div
          className={`mb-3 shrink-0 rounded-sm border border-coop-border bg-[#252526] px-3 py-2 transition-opacity duration-300 ${
            editPhase === "prompt" || editPhase === "diff" || editPhase === "hold"
              ? "opacity-100"
              : "opacity-0"
          }`}
        >
          <p className="text-[10px] text-coop-muted">
            <span className="text-coop-index">⌥K</span> edit
          </p>
          <p className="mt-1 text-[12px] text-white/90">{story.instruction}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {story.kind === "complete" ? (
          <CompleteEditorBody
            story={story}
            phase={completePhase}
            ghostVisibleChars={ghostVisibleChars}
          />
        ) : (
          <EditEditorBody story={story} phase={editPhase} />
        )}
      </div>

      <p className="mt-3 shrink-0 font-mono text-[10px] text-coop-muted">
        <span className="text-coop-index">//</span> {story.contextHint}
      </p>

      {story.kind === "complete" && completePhase === "accepted" ? (
        <span className="absolute bottom-3 right-3 rounded-sm border border-coop-border bg-[#252526] px-2 py-0.5 font-mono text-[10px] text-coop-index">
          Tab accepted
        </span>
      ) : null}
    </>
  );
}

function CompleteEditorBody({
  story,
  phase,
  ghostVisibleChars = 0
}: {
  story: CompleteStory;
  phase: CompletePhase;
  ghostVisibleChars?: number;
}) {
  const showGhost = phase === "ghost" || phase === "accepted" || phase === "hold";
  const accepted = phase === "accepted" || phase === "hold";
  const visibleGhost = showGhost ? story.ghostSuffix.slice(0, ghostVisibleChars) : "";

  return (
    <>
      {story.lines.map((line) => (
        <CodeEditorLineRow key={line.n} line={line} />
      ))}
      <div className="flex gap-2 rounded-sm pr-4">
        <span className="w-4 shrink-0 select-none text-right text-[#858585]">{story.cursorLine}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
          <span className={TOKEN_COLOR.plain}>{story.typedPrefix}</span>
          {visibleGhost ? (
            <span className={accepted ? "text-[#d4d4d4]" : "text-white/35"}>{visibleGhost}</span>
          ) : null}
          {(phase === "idle" || !showGhost || ghostVisibleChars < story.ghostSuffix.length) && !accepted ? (
            <span className="story-cursor ml-0.5 inline-block h-3.5 w-1 bg-coop-index" aria-hidden />
          ) : null}
        </span>
      </div>
    </>
  );
}

function EditEditorBody({ story, phase }: { story: EditStory; phase: EditPhase }) {
  const showDiff = phase === "diff" || phase === "hold";
  const showSelection = phase === "select" || phase === "prompt";

  return (
    <>
      {story.lines.map((line) => {
        const inSelection =
          showSelection && line.n >= story.selectionStart && line.n <= story.selectionEnd;
        const hideDiffAdd = !showDiff && line.diffAdd;
        const hideDiffRemove = showDiff && line.diffRemove;

        if (hideDiffAdd || hideDiffRemove) {
          return null;
        }

        return (
          <CodeEditorLineRow
            key={line.n}
            line={{
              ...line,
              highlight: inSelection || (showDiff && (line.diffAdd || line.diffRemove))
            }}
            diffTone={
              showDiff && line.diffRemove ? "remove" : showDiff && line.diffAdd ? "add" : undefined
            }
          />
        );
      })}
    </>
  );
}

function CodeEditorLineRow({
  line,
  diffTone
}: {
  line: CodeEditorLine;
  diffTone?: "add" | "remove";
}) {
  const rowClass =
    diffTone === "remove"
      ? "bg-red-500/10 ring-1 ring-inset ring-red-500/25"
      : diffTone === "add"
        ? "bg-coop-index/10 ring-1 ring-inset ring-coop-index/35"
        : line.highlight
          ? "bg-coop-index/8 ring-1 ring-inset ring-coop-index/25"
          : "";

  return (
    <div className={`flex gap-2 rounded-sm pr-4 ${rowClass}`}>
      <span className="w-4 shrink-0 select-none text-right text-[#858585]">{line.n}</span>
      <span className="min-w-0 flex-1">
        {line.tokens.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          line.tokens.map((tok, i) => (
            <span key={i} className={TOKEN_COLOR[tok.t]}>
              {tok.v}
            </span>
          ))
        )}
      </span>
    </div>
  );
}
