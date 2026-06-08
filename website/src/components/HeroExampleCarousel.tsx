"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

export type HeroExample = {
  id: string;
  question: string;
  highlights: [string, string];
};

export const HERO_EXAMPLES: HeroExample[] = [
  {
    id: "ownership",
    question:
      "Who owns `services/billing/invoice_handler.go`? I need to change idempotency keys — CODEOWNERS says @platform-payments but git blame shows @marcus. Does `pkg/ledger/posting.go` share the same on-call rotation?",
    highlights: ["CODEOWNERS + blame", "cross-package owners"]
  },
  {
    id: "blast-radius",
    question:
      "If I refactor `TokenValidator.validate()` in `internal/auth/token_validator.ts`, what breaks downstream? List dependents in `api-gateway`, `workers/webhook-processor`, and any shared libs that import this symbol.",
    highlights: ["symbol graph dependents", "cross-service impact"]
  },
  {
    id: "reviewers",
    question:
      "Who should review my PR touching `migrations/008_session_index.sql`, `auth_middleware.go`, and `session/store.go`? Want reviewers with context on incident #inc-auth-992 and recent changes to the OAuth refresh path.",
    highlights: ["blame-aware reviewers", "incident + PR context"]
  },
  {
    id: "understand-repo",
    question:
      "I'm onboarding to `coop-backend` — where does webhook ingestion start, and how do events flow into the job queue vs `GraphCache`? What are the 5 files I should read first to trace a GitHub `push` end-to-end?",
    highlights: ["entrypoints + data flow", "read order by layer"]
  },
  {
    id: "knowledge-gaps",
    question:
      "Before I ship changes to `GraphConsistencyManager.applyEvent()`, what am I missing? Any Slack threads or Jira tickets on webhook dedupe, and who last modified the Slack normalization path in `handlers/slackWebhookHandler.ts`?",
    highlights: ["undocumented decisions", "Slack + Jira cross-ref"]
  },
  {
    id: "integrations",
    question:
      "Pull the Slack thread and Jira ticket tied to `auth_middleware.go` — why did we add zero-retention headers here? Cross-reference commits on `internal/llm/router.go` from the last 90 days and link the original design note.",
    highlights: ["#platform-auth thread", "PROJ-1847 + commits"]
  },
  {
    id: "inline-complete",
    question:
      "I'm finishing the empty-payload guard in `token_validator.ts` — complete the `if` using the same `AuthError` pattern as the rest of `billing/auth` and what our graph shows for downstream callers.",
    highlights: ["ghost-text complete", "graph · AuthError pattern"]
  },
  {
    id: "edit-selection",
    question:
      "Select the refresh-token branch in `oauth_refresh.ts` and edit it to match rejection semantics from `token_validator.ts` — throw `AuthError('empty_or_unsigned_payload')` instead of returning null.",
    highlights: ["⌥K edit selection", "inline diff accept"]
  }
];

const ROTATE_MS = 4500;
const FADE_MS = 520;

type HeroExampleCarouselProps = {
  /** ~40% shorter layout for placement below the product mock */
  compact?: boolean;
};

export function HeroExampleCarousel({ compact = false }: HeroExampleCarouselProps) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeExample = HERO_EXAMPLES[index];
  const isCopied = copiedId === activeExample.id;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      setVisible(false);
      fadeTimeoutRef.current = setTimeout(() => {
        setIndex((nextIndex + HERO_EXAMPLES.length) % HERO_EXAMPLES.length);
        setVisible(true);
      }, FADE_MS);
    },
    []
  );

  const advance = useCallback(() => {
    goTo(index + 1);
  }, [goTo, index]);

  useEffect(() => {
    if (reduceMotion || paused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    timerRef.current = setInterval(advance, ROTATE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [advance, paused, reduceMotion]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  async function handleActivate(target: HeroExample) {
    setPaused(true);
    try {
      await navigator.clipboard.writeText(target.question);
      setCopiedId(target.id);
      window.setTimeout(() => setCopiedId(null), 2200);
    } catch {
      setCopiedId(null);
    }
    window.setTimeout(() => setPaused(false), 4000);
  }

  function handleDotClick(i: number) {
    if (i === index) return;
    setPaused(true);
    goTo(i);
    window.setTimeout(() => setPaused(false), ROTATE_MS * 2);
  }

  const demoHref = `/demo?prompt=${encodeURIComponent(activeExample.question)}`;

  const cardPadding = compact
    ? "px-5 py-5 md:px-6 md:py-6"
    : "px-6 py-8 md:px-10 md:py-9";

  return (
    <div
      className={`animate-fade-up mx-auto ${compact ? "max-w-4xl" : "max-w-3xl"} ${compact ? "" : "mt-8"}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div
        className={`coop-panel-inset relative overflow-hidden rounded-sm ${cardPadding}`}
      >

        {/* In-flow sizer: all slides visible to layout (fixes mobile Safari grid + opacity) */}
        <div className="relative">
          <div className="invisible grid [&>*]:col-start-1 [&>*]:row-start-1" aria-hidden>
            {HERO_EXAMPLES.map((item) => (
              <HeroSlideBody key={`sizer-${item.id}`} item={item} compact={compact} />
            ))}
          </div>

          <div className="absolute inset-0 grid [&>*]:col-start-1 [&>*]:row-start-1" aria-live="polite">
            {HERO_EXAMPLES.map((item, i) => {
              const isActive = i === index;
              const showSlide = isActive && visible;

              return (
                <div
                  key={item.id}
                  className={`flex flex-col transition-opacity duration-500 ${
                    showSlide
                      ? "z-10 opacity-100"
                      : "pointer-events-none z-0 opacity-0"
                  }`}
                  aria-hidden={!isActive}
                >
                  <HeroSlideBody
                    item={item}
                    compact={compact}
                    interactive
                    isActive={isActive}
                    onActivate={() => handleActivate(item)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div
          className={`flex flex-col items-center gap-2 sm:flex-row sm:justify-between ${
            compact ? "mt-3 min-h-[4.25rem] sm:min-h-0" : "mt-6 min-h-[3.5rem] gap-3 sm:min-h-0"
          }`}
        >
          <div className="flex items-center gap-2" role="tablist" aria-label="Example questions">
            {HERO_EXAMPLES.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Show example: ${item.question}`}
                onClick={() => handleDotClick(i)}
                className={`rounded-full transition-all duration-300 ${
                  compact ? "h-1" : "h-1.5"
                } ${
                  i === index
                    ? compact
                      ? "w-5 bg-coop-index"
                      : "w-7 bg-coop-index"
                    : compact
                      ? "w-1 bg-white/20 hover:bg-white/40"
                      : "w-1.5 bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>

          <p
            className={`text-center text-coop-muted sm:text-right ${
              compact ? "text-[10px] leading-tight" : "text-xs"
            }`}
          >
            {isCopied ? (
              <span className="font-medium text-coop-index">Copied to clipboard</span>
            ) : (
              <>
                <span className="text-white/50">Click to copy</span>
                {!compact ? (
                  <>
                    <span className="mx-2 text-white/20" aria-hidden>
                      ·
                    </span>
                    <Link
                      href={demoHref}
                      className="font-medium text-white/70 underline-offset-4 transition hover:text-white hover:underline"
                    >
                      Book a demo with this example
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="mx-1.5 text-white/20" aria-hidden>
                      ·
                    </span>
                    <Link
                      href={demoHref}
                      className="font-medium text-white/70 underline-offset-2 transition hover:text-white hover:underline"
                    >
                      Demo
                    </Link>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {reduceMotion ? (
        <p
          className={`text-center text-coop-muted ${compact ? "mt-2 text-[10px]" : "mt-3 text-[11px]"}`}
        >
          Motion reduced — use the dots to browse examples.
        </p>
      ) : null}
    </div>
  );
}

function HeroSlideBody({
  item,
  compact,
  interactive = false,
  isActive = false,
  onActivate
}: {
  item: HeroExample;
  compact: boolean;
  interactive?: boolean;
  isActive?: boolean;
  onActivate?: () => void;
}) {
  const question = (
    <p
      className={`text-left font-normal leading-relaxed text-white ${
        compact ? "text-[13px] md:text-sm" : "text-base md:text-lg lg:text-xl"
      }`}
    >
      <span className="text-white/25" aria-hidden>
        &ldquo;
      </span>
      <QuestionText text={item.question} />
      <span className="text-white/25" aria-hidden>
        &rdquo;
      </span>
    </p>
  );

  return (
    <div className="flex flex-col">
      {interactive ? (
        <button
          type="button"
          onClick={onActivate}
          tabIndex={isActive ? 0 : -1}
          className="group w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-coop-index/50 focus-visible:ring-offset-2 focus-visible:ring-offset-coop-dark"
          aria-label={`Example question: ${item.question}. Click to copy.`}
        >
          {question}
        </button>
      ) : (
        <div className="w-full">{question}</div>
      )}

      <div
        className={`flex flex-wrap items-center justify-start gap-1.5 md:gap-2 ${
          compact ? "mt-4" : "mt-5 md:gap-2.5"
        }`}
      >
        <HighlightPill compact={compact}>{item.highlights[0]}</HighlightPill>
        <span className="text-[10px] font-medium uppercase tracking-widest text-white/20" aria-hidden>
          +
        </span>
        <HighlightPill compact={compact} variant="muted">
          {item.highlights[1]}
        </HighlightPill>
      </div>
    </div>
  );
}

function QuestionText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);

  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={i}
            className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.92em] text-coop-index/95"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function HighlightPill({
  children,
  variant = "default",
  compact = false
}: {
  children: React.ReactNode;
  variant?: "default" | "muted";
  compact?: boolean;
}) {
  const size = compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs md:text-sm";

  return (
    <span
      className={
        variant === "default"
          ? `inline-flex items-center rounded-sm border border-coop-border bg-coop-surface font-mono text-coop-index ${size}`
          : `inline-flex items-center rounded-sm border border-coop-border bg-coop-editor font-mono text-white/70 ${size}`
      }
    >
      {children}
    </span>
  );
}
