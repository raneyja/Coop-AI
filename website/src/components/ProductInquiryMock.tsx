"use client";

import type { CodeToken, InquiryProductMockScenario } from "@/lib/productMockScenarios";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  holdMs: 4800
};

const CALLOUT_BORDER = {
  violet: "border-violet-400/30 shadow-violet-500/10",
  amber: "border-amber-400/30 shadow-amber-500/10",
  accent: "border-coop-index/30 shadow-coop-index/10"
} as const;

type ProductInquiryMockProps = {
  scenario: InquiryProductMockScenario;
  className?: string;
  onCycleComplete?: () => void;
};

export function ProductInquiryMock({
  scenario,
  className = "",
  onCycleComplete
}: ProductInquiryMockProps) {
  const [phase, setPhase] = useState<Phase>("typing");
  const [typedLen, setTypedLen] = useState(0);
  const [searchStep, setSearchStep] = useState(-1);
  const [visibleBlocks, setVisibleBlocks] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const runId = useRef(0);

  const answerBlockCount = useMemo(
    () => parseChatProse(scenario.answer.content).blocks.length,
    [scenario.answer.content]
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
    setTypedLen(0);
    setSearchStep(-1);
    setVisibleBlocks(0);
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

    async function runFlow() {
      reset();

      if (reduceMotion) {
        setTypedLen(scenario.question.length);
        setSearchStep(scenario.searchSteps.length - 1);
        setVisibleBlocks(answerBlockCount);
        setPhase("hold");
        onCycleComplete?.();
        return;
      }

      setPhase("typing");
      for (let i = 1; i <= scenario.question.length; i++) {
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

      for (let i = 0; i < scenario.searchSteps.length; i++) {
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

      setPhase("hold");
      await wait(TIMING.holdMs);
      if (cancelled || runId.current !== id) return;

      onCycleComplete?.();
    }

    runFlow();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [scenario, reduceMotion, reset, answerBlockCount, onCycleComplete]);

  const typedQuestion = scenario.question.slice(0, typedLen);
  const showComposer = phase === "typing" || phase === "submitting";
  const showUserBubble = phase === "searching" || phase === "answering" || phase === "hold";
  const showCodeHighlight = phase === "answering" || phase === "hold";

  const gradientId = `mock-bridge-${scenario.id}`;

  const { containerRef: threadRef, anchorRef: threadAnchorRef } = useChatScrollAnchor([
    phase,
    visibleBlocks,
    searchStep,
    showUserBubble
  ]);

  return (
    <div
      className={`relative mx-auto w-full max-w-[52rem] ${className}`}
      role="img"
      aria-label={scenario.ariaLabel}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm bg-[#1e1e1e] ring-1 ring-coop-border">
        <div className="flex items-center gap-3 border-b border-[#2a2a2a] bg-[#252526] px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[11px] text-coop-muted">
            <span className="rounded-t bg-[#1e1e1e] px-2.5 py-1 text-white/85">{scenario.tabs.active}</span>
            {scenario.tabs.inactive ? (
              <span className="px-2 py-1 opacity-40">{scenario.tabs.inactive}</span>
            ) : null}
          </div>
          <span className="font-mono text-[10px] text-coop-muted">CoopAI</span>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="relative z-10 flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-[#2a2a2a] bg-[#1e1e1e] md:w-[44%] md:border-b-0 md:border-r">
            <div
              ref={threadRef}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2 pt-3"
            >
              <div className="flex min-h-full w-full flex-col justify-end gap-3">
                {showUserBubble && (
                  <div className="story-bubble-in max-w-[96%] self-end rounded-xl bg-[#2a2a2a] px-3 py-2.5 ring-1 ring-[#3a3a3a]">
                    <p className="text-[13px] leading-relaxed text-darkUi-body">{scenario.question}</p>
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
                          steps={scenario.searchSteps}
                          activeIndex={searchStep}
                          searching
                        />
                      </>
                    ) : (
                      <StoryChatProse
                        content={scenario.answer.content}
                        visibleCount={visibleBlocks}
                        streaming={phase === "answering"}
                      />
                    )}
                  </div>
                )}

                <div ref={threadAnchorRef} className="h-px shrink-0" aria-hidden />
              </div>
            </div>

            <div className="shrink-0 border-t border-[#2a2a2a] px-3 pb-3 pt-2">
              <StoryComposer
                showComposer={showComposer}
                typedQuestion={typedQuestion}
                isTyping={phase === "typing"}
                isSubmitting={phase === "submitting"}
              />
            </div>
          </aside>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e] p-3 font-mono text-[11px] leading-[1.55] md:p-4">
            <div className="min-h-0 flex-1 overflow-hidden">
              {scenario.code.lines.map((line) => (
                <CodeLine
                  key={line.n}
                  n={line.n}
                  tokens={line.tokens}
                  highlight={showCodeHighlight && line.highlight}
                />
              ))}
            </div>

            {showCodeHighlight ? (
              <div
                className={`story-bubble-in absolute right-2 top-[5.5rem] max-w-[11rem] rounded-md border bg-[#252526]/95 px-2 py-1.5 text-[9px] leading-snug shadow-lg backdrop-blur-sm md:right-4 ${CALLOUT_BORDER[scenario.code.callout.tone]}`}
              >
                <p
                  className={
                    scenario.code.callout.tone === "amber"
                      ? "font-medium text-amber-200/95"
                      : scenario.code.callout.tone === "violet"
                        ? "font-medium text-violet-200/95"
                        : "font-medium text-coop-index"
                  }
                >
                  {scenario.code.callout.title}
                </p>
                <p className="mt-0.5 text-coop-muted">{scenario.code.callout.subtitle}</p>
                <p className="mt-0.5 text-white/70">{scenario.code.callout.detail}</p>
              </div>
            ) : null}
          </div>

          <svg
            className="pointer-events-none absolute inset-0 z-20 hidden md:block"
            viewBox="0 0 800 320"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#58A6FF" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#A371F7" stopOpacity="0.85" />
              </linearGradient>
            </defs>
            {showCodeHighlight ? (
              <>
                <path
                  d="M 318 188 L 318 158 L 355 158 L 355 132"
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="1.5"
                  strokeOpacity="0.65"
                />
                <circle cx="355" cy="132" r="3" fill="#58A6FF" fillOpacity="0.9" />
                <circle cx="318" cy="188" r="3" fill="#58A6FF" fillOpacity="0.9" />
              </>
            ) : null}
          </svg>
        </div>
      </div>
    </div>
  );
}

function CodeLine({
  n,
  tokens,
  highlight
}: {
  n: number;
  tokens: CodeToken[];
  highlight?: boolean;
}) {
  const color: Record<CodeToken["t"], string> = {
    keyword: "text-[#569cd6]",
    fn: "text-[#dcdcaa]",
    type: "text-[#4ec9b0]",
    string: "text-[#ce9178]",
    comment: "text-[#6a9955]",
    plain: "text-darkUi-plain"
  };

  return (
    <div
      className={`flex gap-2 rounded-sm pr-28 ${highlight ? "bg-coop-index/10 ring-1 ring-inset ring-coop-index/35" : ""}`}
    >
      <span className="w-4 shrink-0 select-none text-right text-darkUi-lineNumber">{n}</span>
      <span className="min-w-0 flex-1">
        {tokens.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          tokens.map((tok, i) => (
            <span key={i} className={color[tok.t]}>
              {tok.v}
            </span>
          ))
        )}
      </span>
    </div>
  );
}
