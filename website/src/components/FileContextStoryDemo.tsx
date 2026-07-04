"use client";

import {
  DEMO_STORIES,
  isCodeCreationStory,
  isInquiryStory,
  type DemoStory
} from "@/lib/demoStories";
import type { CompleteStory, EditStory } from "@/lib/codeCreationScenarios";
import type { InquiryStory } from "@/lib/fileContextStoryScenarios";
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
import type { StorySearchStep } from "@/lib/fileContextStoryScenarios";

type Phase = "typing" | "submitting" | "searching" | "answering" | "hold";

const PHASE_LABEL: Record<Phase, string> = {
  typing: "Developer asks a question",
  submitting: "Sending to CoopAI",
  searching: "Searching across your stack",
  answering: "Grounded answer with citations",
  hold: ""
};

/** Fixed outer + body heights so carousel slides never shift layout */
const SHELL = {
  homepage: {
    root: "h-[532px] min-h-[532px] sm:h-[552px] sm:min-h-[552px]",
    body: "h-[380px] min-h-[380px] sm:h-[400px] sm:min-h-[400px]"
  },
  preview: {
    root: "h-[672px] min-h-[672px]",
    body: "h-[540px] min-h-[540px]"
  }
} as const;

const TIMING = {
  charMs: 32,
  afterTypingMs: 500,
  submittingMs: 700,
  searchStepMs: 680,
  contextMs: 1200,
  answerBlockMs: 1200,
  holdMs: 6200,
  fadeMs: 400,
  completeGhostCharMs: 14,
  completeAcceptedMs: 700,
  editSelectMs: 700,
  editPromptMs: 900,
  editDiffMs: 900
};

function storyQuestion(story: DemoStory): string {
  return story.question;
}

function storySearchSteps(story: DemoStory): StorySearchStep[] {
  return story.searchSteps;
}

function storyInactiveTab(story: DemoStory): string {
  if (isInquiryStory(story)) return "session_store.go";
  return story.inactiveTab ?? "session_store.go";
}

function answerContent(story: DemoStory): string {
  if (isInquiryStory(story)) return story.answer.content;
  return story.outcome.content;
}

export function FileContextStoryDemo({
  className = "",
  variant = "preview"
}: {
  className?: string;
  variant?: "preview" | "homepage";
}) {
  const [storyIndex, setStoryIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [completePhase, setCompletePhase] = useState<CompletePhase>("idle");
  const [editPhase, setEditPhase] = useState<EditPhase>("idle");
  const [typedLen, setTypedLen] = useState(0);
  const [searchStep, setSearchStep] = useState(-1);
  const [visibleBlocks, setVisibleBlocks] = useState(0);
  const [ghostVisibleChars, setGhostVisibleChars] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [fading, setFading] = useState(false);
  const runId = useRef(0);

  const story = DEMO_STORIES[storyIndex];
  const question = storyQuestion(story);
  const searchSteps = storySearchSteps(story);
  const answerBlockCount = useMemo(
    () => parseChatProse(answerContent(story)).blocks.length,
    [story]
  );

  const shell = SHELL[variant];
  const isHomepage = variant === "homepage";

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const resetForStory = useCallback(() => {
    setPhase("typing");
    setCompletePhase("idle");
    setEditPhase("idle");
    setTypedLen(0);
    setSearchStep(-1);
    setVisibleBlocks(0);
    setGhostVisibleChars(0);
  }, []);

  const advanceStory = useCallback(() => {
    setFading(true);
    window.setTimeout(() => {
      setStoryIndex((i) => (i + 1) % DEMO_STORIES.length);
      resetForStory();
      setFading(false);
    }, TIMING.fadeMs);
  }, [resetForStory]);

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

    async function runSharedPromptFlow() {
      resetForStory();

      if (reduceMotion) {
        setTypedLen(question.length);
        setSearchStep(searchSteps.length - 1);
        setPhase("answering");
        setVisibleBlocks(answerBlockCount);
        if (isCodeCreationStory(story)) {
          if (story.kind === "complete") {
            setCompletePhase("accepted");
            setGhostVisibleChars(story.ghostSuffix.length);
          } else {
            setEditPhase("diff");
          }
        }
        setPhase("hold");
        timers.push(setTimeout(advanceStory, TIMING.holdMs * 2));
        return;
      }

      setPhase("typing");
      for (let i = 1; i <= question.length; i++) {
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

      for (let i = 0; i < searchSteps.length; i++) {
        await wait(i === 0 ? 400 : TIMING.searchStepMs);
        if (cancelled || runId.current !== id) return;
        setSearchStep(i);
      }

      await wait(TIMING.contextMs);
      if (cancelled || runId.current !== id) return;
      setPhase("answering");

      for (let b = 0; b < answerBlockCount; b++) {
        await wait(b === 0 ? 300 : TIMING.answerBlockMs);
        if (cancelled || runId.current !== id) return;
        setVisibleBlocks(b + 1);
      }

      if (isCodeCreationStory(story)) {
        if (story.kind === "complete") {
          await runCompleteOutcome(story);
        } else {
          await runEditOutcome(story);
        }
      }

      setPhase("hold");
      await wait(TIMING.holdMs);
      if (cancelled || runId.current !== id) return;
      advanceStory();
    }

    async function runCompleteOutcome(completeStory: CompleteStory) {
      setCompletePhase("ghost");
      for (let i = 1; i <= completeStory.ghostSuffix.length; i++) {
        await wait(TIMING.completeGhostCharMs);
        if (cancelled || runId.current !== id) return;
        setGhostVisibleChars(i);
      }
      setCompletePhase("accepted");
      await wait(TIMING.completeAcceptedMs);
    }

    async function runEditOutcome(editStory: EditStory) {
      setEditPhase("select");
      await wait(TIMING.editSelectMs);
      if (cancelled || runId.current !== id) return;
      setEditPhase("prompt");
      await wait(TIMING.editPromptMs);
      if (cancelled || runId.current !== id) return;
      setEditPhase("diff");
      await wait(TIMING.editDiffMs);
    }

    runSharedPromptFlow();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [
    storyIndex,
    reduceMotion,
    story,
    advanceStory,
    resetForStory,
    answerBlockCount,
    question,
    searchSteps
  ]);

  const progressDots = useMemo(
    () =>
      DEMO_STORIES.map((s, i) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Show scenario: ${s.feature}`}
          onClick={() => {
            if (i === storyIndex) return;
            runId.current++;
            setStoryIndex(i);
          }}
          className={`h-1.5 rounded-full transition-all ${
            i === storyIndex ? "w-6 bg-coop-index" : "w-1.5 bg-white/20 hover:bg-white/40"
          }`}
        />
      )),
    [storyIndex]
  );

  const typedQuestion = question.slice(0, typedLen);
  const showComposer = phase === "typing" || phase === "submitting";
  const showUserBubble = phase === "searching" || phase === "answering" || phase === "hold";
  const focusComposer = isHomepage && showComposer;
  /** Homepage typing uses full demo width; split resumes for context + outcome */
  const fullWidthPrompt = focusComposer;

  const chatColumnWidth = isHomepage ? "sm:w-[54%]" : "sm:w-[44%]";

  const { containerRef: threadRef, anchorRef: threadAnchorRef } = useChatScrollAnchor([
    phase,
    visibleBlocks,
    searchStep,
    storyIndex,
    showUserBubble,
    focusComposer,
    completePhase,
    editPhase
  ]);

  const showEditorOutcome =
    isCodeCreationStory(story) && (phase === "answering" || phase === "hold");
  const showInquiryPreview = isInquiryStory(story);

  return (
    <div className={`file-context-story flex flex-col ${shell.root} ${className}`.trim()}>
      {isHomepage ? (
        <div className="mb-4 flex shrink-0 justify-center">{progressDots}</div>
      ) : (
        <div className="mb-5 flex shrink-0 flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {progressDots}
            <span className="ml-2 text-xs text-coop-muted">
              Scenario {storyIndex + 1} of {DEMO_STORIES.length} · {story.feature}
            </span>
          </div>
          {PHASE_LABEL[phase] ? (
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-coop-index" aria-live="polite">
              {PHASE_LABEL[phase]}
            </p>
          ) : null}
        </div>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm bg-[#1e1e1e] ring-1 ring-coop-border transition-opacity duration-300 ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[#2a2a2a] bg-[#252526] px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[11px] text-coop-muted">
            <span className="rounded-t bg-[#1e1e1e] px-2.5 py-1 text-white/85">{story.activeTab}</span>
            <span className="px-2 py-1 opacity-40">{storyInactiveTab(story)}</span>
          </div>
          <span className="font-mono text-[10px] text-coop-muted">CoopAI</span>
        </div>

        <div className={`flex min-h-0 ${shell.body} flex-col ${fullWidthPrompt ? "" : "sm:flex-row"}`}>
          {fullWidthPrompt ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-5 md:px-6">
              <StoryComposer
                showComposer={showComposer}
                typedQuestion={typedQuestion}
                isTyping={phase === "typing"}
                isSubmitting={phase === "submitting"}
              />
            </div>
          ) : (
            <>
          {/* Chat column — prompt → context → outcome */}
          <div
            className={`flex min-h-0 w-full shrink-0 flex-col border-b border-[#2a2a2a] sm:h-full ${chatColumnWidth} sm:border-b-0 sm:border-r`}
          >
                <div
                  ref={threadRef}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2 pt-3 md:px-4"
                >
                  <div className="flex min-h-full w-full flex-col justify-end gap-3">
                    {showUserBubble && (
                      <div className="story-bubble-in max-w-[96%] self-end rounded-xl bg-[#2a2a2a] px-3 py-2.5 ring-1 ring-[#3a3a3a]">
                        <p className="text-[13px] leading-relaxed text-darkUi-body">{question}</p>
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
                              steps={searchSteps}
                              activeIndex={searchStep}
                              searching
                            />
                          </>
                        ) : (
                          <StoryChatProse
                            content={answerContent(story)}
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
                  className={`shrink-0 px-3 pb-3 md:px-4 ${showUserBubble ? "border-t border-[#2a2a2a] pt-2" : "pt-3"}`}
                >
                  <StoryComposer
                    showComposer={showComposer}
                    typedQuestion={typedQuestion}
                    isTyping={phase === "typing"}
                    isSubmitting={phase === "submitting"}
                  />
                </div>
          </div>

          {/* Editor column — always present to prevent layout shift */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {isCodeCreationStory(story) ? (
              <EditorCodeCreationPanel
                embedded
                story={story}
                completePhase={showEditorOutcome ? completePhase : "idle"}
                editPhase={showEditorOutcome ? editPhase : "idle"}
                ghostVisibleChars={ghostVisibleChars}
                className="h-full"
              />
            ) : showInquiryPreview ? (
              <InquiryEditorPreview story={story} phase={phase} />
            ) : null}
          </div>
            </>
          )}
        </div>
      </div>

      {!isHomepage ? (
        <p className="mt-5 shrink-0 text-center text-sm text-coop-muted">
          Auto-playing demo — click the dots to jump scenarios. Every slide follows prompt → context
          → outcome.
        </p>
      ) : null}
    </div>
  );
}

function InquiryEditorPreview({
  story,
  phase
}: {
  story: InquiryStory;
  phase: Phase;
}) {
  const active = phase === "answering" || phase === "hold";
  const searching = phase === "searching";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1e1e1e] p-3 font-mono text-[11px] leading-[1.55] md:p-4">
      <p className="shrink-0 text-[10px] text-coop-muted">
        {story.file.path}
        <span className="text-white/85">{story.file.name}</span>
      </p>
      <p className="mt-1 shrink-0 text-[10px] text-coop-index">{story.file.symbol}</p>

      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={`flex gap-2 rounded-sm py-0.5 pr-2 ${
              active && n === 3 ? "bg-coop-index/10 ring-1 ring-inset ring-coop-index/35" : ""
            }`}
          >
            <span className="w-4 shrink-0 text-right text-darkUi-lineNumber">{n}</span>
            <span
              className={`h-3 flex-1 rounded-sm ${
                active && n === 3 ? "bg-coop-index/20" : "bg-white/[0.06]"
              }`}
            />
          </div>
        ))}
      </div>

      <p className="mt-3 shrink-0 text-[10px] text-coop-muted">
        {searching ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-coop-index" aria-hidden />
            Indexing symbol graph…
          </span>
        ) : active ? (
          <>
            <span className="text-coop-index">//</span> {story.file.language} · graph context
          </>
        ) : (
          <>
            <span className="text-coop-index">//</span> open file
          </>
        )}
      </p>
    </div>
  );
}
