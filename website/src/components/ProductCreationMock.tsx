"use client";

import type { CodeCreationStory } from "@/lib/codeCreationScenarios";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EditorCodeCreationPanel,
  type CompletePhase,
  type EditPhase
} from "./EditorCodeCreationPanel";
import { StoryChatProse } from "./StoryChatProse";
import { StoryComposer } from "./StoryComposer";
import { StorySearchStepList } from "./StorySearchStepList";
import { parseChatProse } from "@/lib/chatProseParser";
import { useChatScrollAnchor } from "@/hooks/useChatScrollAnchor";

type Phase = "typing" | "submitting" | "searching" | "answering" | "hold";

const TIMING = {
  charMs: 28,
  afterTypingMs: 450,
  submittingMs: 600,
  searchStepMs: 620,
  contextMs: 900,
  answerBlockMs: 900,
  holdMs: 4800,
  completeGhostCharMs: 12,
  completeAcceptedMs: 600,
  editSelectMs: 600,
  editPromptMs: 800,
  editDiffMs: 800
};

type ProductCreationMockProps = {
  story: CodeCreationStory;
  tabs: { active: string; inactive?: string };
  ariaLabel: string;
  className?: string;
  /** When true, loop animation (carousel). When false, play once and hold. */
  loop?: boolean;
  onCycleComplete?: () => void;
};

export function ProductCreationMock({
  story,
  tabs,
  ariaLabel,
  className = "",
  loop = false,
  onCycleComplete
}: ProductCreationMockProps) {
  const [phase, setPhase] = useState<Phase>("typing");
  const [completePhase, setCompletePhase] = useState<CompletePhase>("idle");
  const [editPhase, setEditPhase] = useState<EditPhase>("idle");
  const [typedLen, setTypedLen] = useState(0);
  const [searchStep, setSearchStep] = useState(-1);
  const [visibleBlocks, setVisibleBlocks] = useState(0);
  const [ghostVisibleChars, setGhostVisibleChars] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const runId = useRef(0);

  const answerBlockCount = useMemo(
    () => parseChatProse(story.outcome.content).blocks.length,
    [story.outcome.content]
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const reset = useCallback(() => {
    setPhase("typing");
    setCompletePhase("idle");
    setEditPhase("idle");
    setTypedLen(0);
    setSearchStep(-1);
    setVisibleBlocks(0);
    setGhostVisibleChars(0);
  }, []);

  useEffect(() => {
    const id = ++runId.current;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled && runId.current === id) resolve();
          }, ms)
        );
      });

    async function runCompleteOutcome() {
      if (story.kind !== "complete") return;
      setCompletePhase("ghost");
      for (let i = 1; i <= story.ghostSuffix.length; i++) {
        await wait(TIMING.completeGhostCharMs);
        if (cancelled || runId.current !== id) return;
        setGhostVisibleChars(i);
      }
      setCompletePhase("accepted");
      await wait(TIMING.completeAcceptedMs);
    }

    async function runEditOutcome() {
      if (story.kind !== "edit") return;
      setEditPhase("select");
      await wait(TIMING.editSelectMs);
      if (cancelled || runId.current !== id) return;
      setEditPhase("prompt");
      await wait(TIMING.editPromptMs);
      if (cancelled || runId.current !== id) return;
      setEditPhase("diff");
      await wait(TIMING.editDiffMs);
    }

    async function runFlow() {
      reset();

      if (reduceMotion) {
        setTypedLen(story.question.length);
        setSearchStep(story.searchSteps.length - 1);
        setVisibleBlocks(answerBlockCount);
        if (story.kind === "complete") {
          setCompletePhase("accepted");
          setGhostVisibleChars(story.ghostSuffix.length);
        } else {
          setEditPhase("diff");
        }
        setPhase("hold");
        onCycleComplete?.();
        return;
      }

      setPhase("typing");
      for (let i = 1; i <= story.question.length; i++) {
        await wait(TIMING.charMs);
        if (cancelled || runId.current !== id) return;
        setTypedLen(i);
      }

      await wait(TIMING.afterTypingMs);
      if (cancelled || runId.current !== id) return;
      setPhase("submitting");

      await wait(TIMING.submittingMs);
      if (cancelled || runId.current !== id) return;
      setPhase("searching");

      for (let i = 0; i < story.searchSteps.length; i++) {
        await wait(i === 0 ? 350 : TIMING.searchStepMs);
        if (cancelled || runId.current !== id) return;
        setSearchStep(i);
      }

      await wait(TIMING.contextMs);
      if (cancelled || runId.current !== id) return;
      setPhase("answering");

      for (let b = 0; b < answerBlockCount; b++) {
        await wait(b === 0 ? 250 : TIMING.answerBlockMs);
        if (cancelled || runId.current !== id) return;
        setVisibleBlocks(b + 1);
      }

      if (story.kind === "complete") {
        await runCompleteOutcome();
      } else {
        await runEditOutcome();
      }

      setPhase("hold");
      await wait(TIMING.holdMs);
      if (cancelled || runId.current !== id) return;

      onCycleComplete?.();
      if (loop) {
        runId.current++;
        runFlow();
      }
    }

    runFlow();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [story, reduceMotion, reset, answerBlockCount, loop, onCycleComplete]);

  const typedQuestion = story.question.slice(0, typedLen);
  const showComposer = phase === "typing" || phase === "submitting";
  const showUserBubble = phase === "searching" || phase === "answering" || phase === "hold";
  const showEditorOutcome = phase === "answering" || phase === "hold";

  const { containerRef: threadRef, anchorRef: threadAnchorRef } = useChatScrollAnchor([
    phase,
    visibleBlocks,
    searchStep,
    showUserBubble,
    completePhase,
    editPhase
  ]);

  return (
    <div
      className={`relative mx-auto flex h-full min-h-0 w-full max-w-[52rem] flex-col overflow-hidden rounded-sm bg-[#1e1e1e] ring-1 ring-coop-border ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[#2a2a2a] bg-[#252526] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[11px] text-coop-muted">
          <span className="rounded-t bg-[#1e1e1e] px-2.5 py-1 text-white/85">{tabs.active}</span>
          {tabs.inactive ? (
            <span className="px-2 py-1 opacity-40">{tabs.inactive}</span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-coop-index">{story.feature}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="relative z-10 flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-[#2a2a2a] bg-[#1e1e1e] md:w-[44%] md:border-b-0 md:border-r">
          <div
            ref={threadRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2 pt-3"
          >
            <div className="flex min-h-full w-full flex-col justify-end gap-3">
              {showUserBubble && (
                <div className="story-bubble-in max-w-[96%] self-end rounded-xl bg-[#2a2a2a] px-3 py-2.5 ring-1 ring-[#3a3a3a]">
                  <p className="text-[13px] leading-relaxed text-darkUi-body">{story.question}</p>
                </div>
              )}

              {(phase === "searching" || phase === "answering" || phase === "hold") && (
                <div
                  className={`story-bubble-in min-w-0 border-l-2 py-1 pl-3 pr-1 ${
                    phase === "searching" ? "border-[#505050]" : "border-coop-index/55"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-darkUi-muted">CoopAI</span>
                    {phase === "searching" && (
                      <Loader2 className="h-3 w-3 animate-spin text-coop-index" aria-hidden />
                    )}
                  </div>

                  {phase === "searching" ? (
                    <>
                      <p className="text-[12px] font-medium text-white/90">
                        Pulling context from your stack…
                      </p>
                      <StorySearchStepList
                        steps={story.searchSteps}
                        activeIndex={searchStep}
                        searching
                      />
                    </>
                  ) : (
                    <StoryChatProse
                      content={story.outcome.content}
                      visibleCount={visibleBlocks}
                      streaming={phase === "answering" && !showEditorOutcome}
                    />
                  )}
                </div>
              )}

              <div ref={threadAnchorRef} className="h-px shrink-0" aria-hidden />
            </div>
          </div>

          <div
            className={`shrink-0 border-t border-[#2a2a2a] px-3 pb-3 pt-2 ${showUserBubble ? "" : ""}`}
          >
            <StoryComposer
              showComposer={showComposer}
              typedQuestion={typedQuestion}
              isTyping={phase === "typing"}
              isSubmitting={phase === "submitting"}
            />
          </div>
        </aside>

        <EditorCodeCreationPanel
          embedded
          story={story}
          completePhase={showEditorOutcome && story.kind === "complete" ? completePhase : "idle"}
          editPhase={showEditorOutcome && story.kind === "edit" ? editPhase : "idle"}
          ghostVisibleChars={ghostVisibleChars}
          className="min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
