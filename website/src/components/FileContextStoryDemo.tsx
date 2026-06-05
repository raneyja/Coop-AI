"use client";

import {
  Check,
  GitGraph,
  Loader2,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StoryChatProse } from "./StoryChatProse";
import { StoryComposer } from "./StoryComposer";
import {
  BitbucketIcon,
  GitHubIcon,
  GitLabIcon,
  JiraIcon,
  SlackIcon,
  type BrandIconProps
} from "./logos/brand-icons";
import { parseChatProse } from "@/lib/chatProseParser";
import {
  FILE_CONTEXT_STORIES,
  type StorySearchStep
} from "@/lib/fileContextStoryScenarios";

type Phase = "typing" | "submitting" | "searching" | "answering" | "hold";

const PHASE_LABEL: Record<Phase, string> = {
  typing: "Developer asks a question",
  submitting: "Sending to CoopAI",
  searching: "Searching across your stack",
  answering: "Grounded answer with citations",
  hold: ""
};

const DEMO_STAGE_H = {
  preview: "h-[600px]",
  homepage: "h-[380px] sm:h-[420px] lg:h-[460px]"
} as const;

const TIMING = {
  charMs: 32,
  afterTypingMs: 500,
  submittingMs: 700,
  searchStepMs: 680,
  contextMs: 1200,
  answerBlockMs: 1200,
  /** Pause after final answer is fully visible before next scenario */
  holdMs: 6200,
  fadeMs: 400
};

const SEARCH_ICONS: Record<
  StorySearchStep["kind"],
  LucideIcon | ((props: BrandIconProps) => ReactNode)
> = {
  graph: GitGraph,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  bitbucket: BitbucketIcon,
  slack: SlackIcon,
  jira: JiraIcon
};

export function FileContextStoryDemo({
  className = "",
  variant = "preview"
}: {
  className?: string;
  /** `homepage` — minimal chrome for the marketing hero; `preview` — full demo page controls */
  variant?: "preview" | "homepage";
}) {
  const [storyIndex, setStoryIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [typedLen, setTypedLen] = useState(0);
  const [searchStep, setSearchStep] = useState(-1);
  const [visibleBlocks, setVisibleBlocks] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [fading, setFading] = useState(false);
  const runId = useRef(0);

  const story = FILE_CONTEXT_STORIES[storyIndex];
  const answerBlockCount = useMemo(
    () => parseChatProse(story.answer.content).blocks.length,
    [story.answer.content]
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const resetForStory = useCallback(() => {
    setPhase("typing");
    setTypedLen(0);
    setSearchStep(-1);
    setVisibleBlocks(0);
  }, []);

  const advanceStory = useCallback(() => {
    setFading(true);
    window.setTimeout(() => {
      setStoryIndex((i) => (i + 1) % FILE_CONTEXT_STORIES.length);
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

    async function run() {
      resetForStory();

      if (reduceMotion) {
        setTypedLen(story.question.length);
        setPhase("searching");
        setSearchStep(story.searchSteps.length - 1);
        setPhase("answering");
        setVisibleBlocks(answerBlockCount);
        setPhase("hold");
        timers.push(setTimeout(advanceStory, TIMING.holdMs * 2));
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

      setPhase("hold");
      await wait(TIMING.holdMs);
      if (cancelled || runId.current !== id) return;
      advanceStory();
    }

    run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [storyIndex, reduceMotion, story, advanceStory, resetForStory, answerBlockCount]);

  const typedQuestion = story.question.slice(0, typedLen);
  const showComposer = phase === "typing" || phase === "submitting";
  const showUserBubble =
    phase === "searching" || phase === "answering" || phase === "hold";
  const phaseLabel = PHASE_LABEL[phase];

  const progressDots = useMemo(
    () =>
      FILE_CONTEXT_STORIES.map((s, i) => (
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
            i === storyIndex ? "w-6 bg-coop-accent" : "w-1.5 bg-white/20 hover:bg-white/40"
          }`}
        />
      )),
    [storyIndex]
  );

  const isHomepage = variant === "homepage";
  const stageHeight = DEMO_STAGE_H[variant];
  const focusComposer = isHomepage && showComposer;

  return (
    <div className={`file-context-story ${className}`.trim()}>
      {isHomepage ? (
        <div className="mb-4 flex justify-center">{progressDots}</div>
      ) : (
        <div className="mb-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {progressDots}
            <span className="ml-2 text-xs text-coop-muted">
              Scenario {storyIndex + 1} of {FILE_CONTEXT_STORIES.length} · {story.feature}
            </span>
          </div>
          {phaseLabel ? (
            <p
              className="text-xs font-medium uppercase tracking-[0.16em] text-coop-accent"
              aria-live="polite"
            >
              {phaseLabel}
            </p>
          ) : null}
        </div>
      )}

      <div
        className={`overflow-hidden rounded-2xl bg-[#1e1e1e] shadow-2xl shadow-black/40 ring-1 ring-[#2a2a2a] transition-opacity duration-300 ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-[#2a2a2a] bg-[#252526] px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[11px] text-coop-muted">
            <span className="rounded-t bg-[#1e1e1e] px-2.5 py-1 text-white/85">{story.activeTab}</span>
            <span className="px-2 py-1 opacity-40">session_store.go</span>
          </div>
          <span className="font-mono text-[10px] text-coop-muted">CoopAI</span>
        </div>

        <div className={`flex ${stageHeight} flex-col bg-[#1e1e1e]`}>
          {focusComposer ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center px-3 py-4 md:px-5">
              <StoryComposer
                showComposer={showComposer}
                typedQuestion={typedQuestion}
                isTyping={phase === "typing"}
                isSubmitting={phase === "submitting"}
              />
            </div>
          ) : (
            <>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-2 pt-3 md:px-5">
              {showUserBubble && (
                <div className="story-bubble-in max-w-[96%] self-end rounded-xl bg-[#2a2a2a] px-3 py-2.5 ring-1 ring-[#3a3a3a]">
                  <p className="text-[13px] leading-relaxed text-[#e5e5e5]">{story.question}</p>
                </div>
              )}

              {(phase === "searching" || phase === "answering" || phase === "hold") && (
                <div
                  className={`story-bubble-in min-w-0 border-l-2 py-1 pl-3 pr-1 ${
                    phase === "searching" ? "border-[#505050]" : "border-coop-accent/55"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[#9d9d9d]">CoopAI</span>
                    {phase === "searching" && (
                      <Loader2 className="h-3 w-3 animate-spin text-coop-accent" aria-hidden />
                    )}
                  </div>

                  {phase === "searching" ? (
                    <>
                      <p className="text-[12px] font-medium text-white/90">
                        Pulling context from your stack…
                      </p>
                      <ul className="mt-3 space-y-2">
                        {story.searchSteps.map((step, i) => (
                          <SearchStepRow
                            key={step.id}
                            step={step}
                            done={i <= searchStep}
                            active={phase === "searching" && i === searchStep}
                          />
                        ))}
                      </ul>
                    </>
                  ) : (
                    <StoryChatProse
                      content={story.answer.content}
                      visibleCount={visibleBlocks}
                      streaming={phase === "answering"}
                    />
                  )}
                </div>
              )}
            </div>

            <div
              className={`shrink-0 px-3 pb-3 md:px-5 ${showUserBubble ? "border-t border-[#2a2a2a] pt-2" : "pt-3"}`}
            >
              <StoryComposer
                showComposer={showComposer}
                typedQuestion={typedQuestion}
                isTyping={phase === "typing"}
                isSubmitting={phase === "submitting"}
              />
            </div>
            </>
          )}
        </div>
      </div>

      {!isHomepage ? (
        <p className="mt-5 text-center text-sm text-coop-muted">
          Auto-playing demo — click the dots to jump scenarios. Hover to pause is not enabled; the
          loop shows how engineers ask questions and get answers grounded in their whole stack.
        </p>
      ) : null}
    </div>
  );
}

function SearchStepRow({
  step,
  done,
  active
}: {
  step: StorySearchStep;
  done: boolean;
  active: boolean;
}) {
  const Icon = SEARCH_ICONS[step.kind];
  return (
    <li
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition ${
        done ? "bg-[#2a2a2a]/80" : "opacity-30"
      } ${active ? "ring-1 ring-coop-accent/25" : ""}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {done && !active ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        ) : active ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-coop-accent" aria-hidden />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
        )}
      </span>
      <BrandOrLucide Icon={Icon} className="h-3.5 w-3.5 shrink-0 text-white/50" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-white/85">{step.label}</p>
        <p className="truncate text-[10px] text-coop-muted">{step.detail}</p>
      </div>
    </li>
  );
}

function BrandOrLucide({
  Icon,
  className
}: {
  Icon: LucideIcon | ((props: BrandIconProps) => ReactNode);
  className?: string;
}) {
  if (Icon === GitHubIcon || Icon === GitLabIcon || Icon === BitbucketIcon || Icon === SlackIcon || Icon === JiraIcon) {
    const Brand = Icon as (props: BrandIconProps) => ReactNode;
    return <Brand className={className} />;
  }
  const Lucide = Icon as LucideIcon;
  return <Lucide className={className} aria-hidden />;
}
