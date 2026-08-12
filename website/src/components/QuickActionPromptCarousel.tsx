"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent
} from "react";
import {
  QUICK_ACTION_PROMPTS,
  SOURCE_LABELS,
  type QuickActionPrompt,
  type QuickActionSource
} from "@/lib/quickActionPrompts";

const ROTATE_MS = 5200;
const FADE_MS = 420;
const SWIPE_THRESHOLD_PX = 48;

export function QuickActionPromptCarousel() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRailRef = useRef<HTMLDivElement | null>(null);
  const chipBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStartX = useRef<number | null>(null);

  const active = QUICK_ACTION_PROMPTS[index];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const goTo = useCallback((nextIndex: number) => {
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    setVisible(false);
    fadeTimeoutRef.current = setTimeout(() => {
      setIndex((nextIndex + QUICK_ACTION_PROMPTS.length) % QUICK_ACTION_PROMPTS.length);
      setVisible(true);
    }, FADE_MS);
  }, []);

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

  // Keep the active command chip visible in the horizontal rail on mobile.
  useEffect(() => {
    const btn = chipBtnRefs.current[index];
    const rail = chipRailRef.current;
    if (!btn || !rail) return;
    const btnLeft = btn.offsetLeft;
    const btnRight = btnLeft + btn.offsetWidth;
    const viewLeft = rail.scrollLeft;
    const viewRight = viewLeft + rail.clientWidth;
    const pad = 16;
    if (btnLeft < viewLeft + pad) {
      rail.scrollTo({ left: Math.max(0, btnLeft - pad), behavior: "smooth" });
    } else if (btnRight > viewRight - pad) {
      rail.scrollTo({ left: btnRight - rail.clientWidth + pad, behavior: "smooth" });
    }
  }, [index]);

  function pauseBriefly() {
    setPaused(true);
    window.setTimeout(() => setPaused(false), ROTATE_MS * 2);
  }

  function handleDotClick(i: number) {
    if (i === index) return;
    pauseBriefly();
    goTo(i);
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX;
    if (end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    pauseBriefly();
    if (delta < 0) goTo(index + 1);
    else goTo(index - 1);
  }

  return (
    <div
      className="mt-8 sm:mt-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="relative -mx-6 sm:mx-0">
        <div
          ref={chipRailRef}
          className="mb-4 flex gap-2 overflow-x-auto scroll-smooth px-6 pb-1 snap-x snap-mandatory sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Quick action examples"
        >
          {QUICK_ACTION_PROMPTS.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                chipBtnRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => handleDotClick(i)}
              className={`min-h-10 shrink-0 snap-start rounded-sm border px-3 py-2 font-mono text-xs transition sm:min-h-0 sm:py-1.5 ${
                i === index
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-coop-border bg-white text-coop-muted hover:border-gray-300 hover:text-gray-900"
              }`}
            >
              {item.command}
            </button>
          ))}
        </div>
        {/* Edge fades hint that the rail scrolls on narrow screens */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent sm:hidden"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent sm:hidden"
          aria-hidden
        />
      </div>

      <div
        className="coop-panel-inset relative overflow-hidden px-4 py-5 touch-pan-y sm:px-8 sm:py-8"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative">
          <div className="invisible grid [&>*]:col-start-1 [&>*]:row-start-1" aria-hidden>
            {QUICK_ACTION_PROMPTS.map((item) => (
              <SlideBody key={`sizer-${item.id}`} item={item} />
            ))}
          </div>

          <div className="absolute inset-0 grid [&>*]:col-start-1 [&>*]:row-start-1" aria-live="polite">
            {QUICK_ACTION_PROMPTS.map((item, i) => {
              const isActive = i === index;
              const showSlide = isActive && visible;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col transition-opacity duration-500 ${
                    showSlide ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
                  }`}
                  aria-hidden={!isActive}
                >
                  <SlideBody item={item} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center gap-3 sm:mt-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-0.5 sm:gap-1" role="group" aria-label="Slide indicators">
            {QUICK_ACTION_PROMPTS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show example ${i + 1}: ${QUICK_ACTION_PROMPTS[i].action}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => handleDotClick(i)}
                className="flex h-10 w-8 items-center justify-center sm:h-8 sm:w-6"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-6 bg-gray-900" : "w-1.5 bg-gray-200"
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="max-w-[16rem] text-center text-[11px] leading-snug text-coop-muted sm:max-w-none sm:text-right sm:text-xs">
            {reduceMotion ? (
              "Motion reduced. Pick a command above."
            ) : (
              <>
                <span className="font-mono text-gray-500">{active.command}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span className="sm:hidden">swipe or tap a command</span>
                <span className="hidden sm:inline">auto-advances · hover to pause</span>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function SlideBody({ item }: { item: QuickActionPrompt }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-sm border border-coop-border bg-gray-100 px-2.5 py-1 font-mono text-xs text-gray-800">
          {item.command}
        </span>
        <span className="text-sm font-medium text-gray-900">{item.action}</span>
      </div>

      <p className="mt-3 break-words text-[15px] leading-relaxed text-gray-900 sm:mt-4 sm:text-base md:text-lg">
        <span className="text-gray-300" aria-hidden>
          &ldquo;
        </span>
        <QuestionText text={item.question} />
        <span className="text-gray-300" aria-hidden>
          &rdquo;
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:mt-5">
        <span className="mr-0.5 font-mono text-[10px] uppercase tracking-widest text-gray-400 sm:mr-1">
          from
        </span>
        {item.sources.map((source) => (
          <SourceChip key={source} source={source} />
        ))}
      </div>

      <div className="mt-4 border-t border-dashed border-coop-border pt-3 sm:mt-5 sm:pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
          // response
        </p>
        <p className="mt-1.5 break-words text-sm font-medium leading-snug text-gray-800 md:text-[15px]">
          {item.teaser}
        </p>
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
            className="break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.88em] text-gray-800 sm:break-words sm:text-[0.92em]"
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

function SourceChip({ source }: { source: QuickActionSource }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-coop-border bg-white px-2 py-0.5 font-mono text-[10px] text-gray-600 sm:text-[11px]">
      {SOURCE_LABELS[source]}
    </span>
  );
}
