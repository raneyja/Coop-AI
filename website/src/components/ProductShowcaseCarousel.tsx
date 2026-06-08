"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductMock } from "./ProductMock";
import { isInquiryProductMock, PRODUCT_MOCK_SCENARIOS } from "@/lib/productMockScenarios";

const ROTATE_MS = 5500;
const FADE_MS = 480;

/** Fixed height so slide changes never shift page layout below the carousel */
const SLIDE_HEIGHT = "h-[32rem] sm:h-[30rem] md:h-[28rem]";

export function ProductShowcaseCarousel() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scenario = PRODUCT_MOCK_SCENARIOS[index];
  const isInquiry = isInquiryProductMock(scenario);

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
      setIndex((nextIndex + PRODUCT_MOCK_SCENARIOS.length) % PRODUCT_MOCK_SCENARIOS.length);
      setVisible(true);
    }, FADE_MS);
  }, []);

  const advance = useCallback(() => {
    goTo(index + 1);
  }, [goTo, index]);

  useEffect(() => {
    if (reduceMotion || paused || !isInquiry) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    timerRef.current = setInterval(advance, ROTATE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [advance, paused, reduceMotion, isInquiry]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  function selectSlide(i: number) {
    if (i === index) return;
    setPaused(true);
    goTo(i);
    window.setTimeout(() => setPaused(false), ROTATE_MS * 2);
  }

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className={`relative w-full ${SLIDE_HEIGHT}`} aria-live="polite" aria-atomic>
        <div
          className={`absolute inset-0 transition-opacity duration-500 ${
            visible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <ProductMock
            key={scenario.id}
            scenario={scenario}
            className="h-full"
            onAnimationComplete={!isInquiry ? advance : undefined}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Product examples">
          {PRODUCT_MOCK_SCENARIOS.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => selectSlide(i)}
              className={`rounded-sm border px-3 py-1.5 font-mono text-xs transition ${
                i === index
                  ? "border-coop-index/50 bg-coop-index/10 text-white"
                  : "border-coop-border bg-coop-editor text-coop-muted hover:border-coop-muted/50 hover:text-white"
              }`}
            >
              {item.feature}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2" aria-hidden>
          {PRODUCT_MOCK_SCENARIOS.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === index ? "w-6 bg-coop-index" : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        {reduceMotion ? (
          <p className="text-center text-[11px] text-coop-muted">
            Motion reduced — select a feature below to browse examples.
          </p>
        ) : (
          <p className="text-center text-xs text-coop-muted">
            {isInquiry
              ? "Auto-advances every few seconds · hover to pause"
              : "Plays prompt → context → outcome · advances when complete · hover to pause"}
          </p>
        )}
      </div>
    </div>
  );
}
