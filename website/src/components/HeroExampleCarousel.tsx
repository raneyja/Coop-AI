"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type HeroExample = {
  id: string;
  question: string;
  highlights: [string, string];
};

export const HERO_EXAMPLES: HeroExample[] = [
  {
    id: "ownership",
    question: "Who owns this code?",
    highlights: ["Code ownership", "Recent contributors"]
  },
  {
    id: "blast-radius",
    question: "What's the blast radius of this change?",
    highlights: ["Impact analysis", "Dependent files"]
  },
  {
    id: "reviewers",
    question: "Who should review this PR?",
    highlights: ["Smart reviewer suggestions", "Blame-aware routing"]
  },
  {
    id: "understand-repo",
    question: "Help me understand this repo",
    highlights: ["Deep repository understanding", "Architecture map"]
  },
  {
    id: "knowledge-gaps",
    question: "What are the knowledge gaps in this area?",
    highlights: ["Missing context", "Tribal knowledge risks"]
  },
  {
    id: "integrations",
    question: "Show me how this connects to Slack and tickets",
    highlights: ["Slack threads", "Jira & ticket context"]
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

  const example = HERO_EXAMPLES[index];
  const isCopied = copiedId === example.id;

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

  const demoHref = `/demo?prompt=${encodeURIComponent(example.question)}`;

  return (
    <div
      className={`animate-fade-up mx-auto max-w-3xl ${compact ? "" : "mt-8"}`}
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
        className={`relative overflow-hidden border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ${
          compact
            ? "rounded-xl px-4 py-4 md:px-5 md:py-4"
            : "rounded-2xl px-6 py-8 md:px-10 md:py-9"
        }`}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-coop-accent/40 to-transparent"
          aria-hidden
        />

        <button
          type="button"
          onClick={() => handleActivate(example)}
          className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-coop-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-coop-dark rounded-lg"
          aria-label={`Example question: ${example.question}. Click to copy.`}
        >
          <p
            className={`font-medium leading-snug tracking-tight text-white transition-opacity duration-500 ${
              compact
                ? "min-h-[2.65rem] text-lg md:min-h-[2.85rem] md:text-xl md:leading-snug"
                : "min-h-[4.5rem] text-2xl md:min-h-[5rem] md:text-[1.75rem] md:leading-tight lg:text-3xl"
            } ${visible ? "opacity-100" : "opacity-0"}`}
          >
            <span className="text-white/25" aria-hidden>
              &ldquo;
            </span>
            {example.question}
            <span className="text-white/25" aria-hidden>
              &rdquo;
            </span>
          </p>
        </button>

        <div
          className={`flex flex-wrap items-center justify-center gap-1.5 transition-opacity duration-500 md:gap-2 ${
            compact ? "mt-2.5" : "mt-5 md:gap-2.5"
          } ${visible ? "opacity-100" : "opacity-0"}`}
          aria-live="polite"
        >
          <HighlightPill compact={compact}>{example.highlights[0]}</HighlightPill>
          <span className="text-[10px] font-medium uppercase tracking-widest text-white/20" aria-hidden>
            +
          </span>
          <HighlightPill compact={compact} variant="muted">
            {example.highlights[1]}
          </HighlightPill>
        </div>

        <div
          className={`flex flex-col items-center gap-2 sm:flex-row sm:justify-between ${
            compact ? "mt-3" : "mt-6 gap-3"
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
                      ? "w-5 bg-coop-accent"
                      : "w-7 bg-coop-accent"
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
              <span className="font-medium text-coop-accent">Copied to clipboard</span>
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
          ? `inline-flex items-center rounded-full border border-coop-accent/25 bg-coop-blue/10 font-medium text-coop-accent ${size}`
          : `inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] font-medium text-white/70 ${size}`
      }
    >
      {children}
    </span>
  );
}
