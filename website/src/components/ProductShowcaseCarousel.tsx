"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductMock } from "./ProductMock";
import { PRODUCT_MOCK_SCENARIOS } from "@/lib/productMockScenarios";

const FADE_MS = 480;

/** Fixed height so slide changes never shift page layout below the carousel */
const SLIDE_HEIGHT = "h-[32rem] sm:h-[30rem] md:h-[28rem]";

export function ProductShowcaseCarousel() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = PRODUCT_MOCK_SCENARIOS[index];

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
    if (paused) return;
    goTo(index + 1);
  }, [goTo, index, paused]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  function selectSlide(i: number) {
    if (i === index) return;
    setPaused(true);
    goTo(i);
    window.setTimeout(() => setPaused(false), 12000);
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
            onAnimationComplete={paused || reduceMotion ? undefined : advance}
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
                  ? "border-gray-900 bg-gray-100 text-gray-900"
                  : "border-coop-border bg-white text-coop-muted hover:border-gray-300 hover:text-gray-900"
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
                i === index ? "w-6 bg-gray-900" : "w-1.5 bg-gray-200"
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
            Plays prompt → context → outcome · advances when complete · hover to pause
          </p>
        )}
      </div>
    </div>
  );
}
