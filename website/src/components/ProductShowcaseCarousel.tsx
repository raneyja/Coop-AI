"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductMock } from "./ProductMock";
import { PRODUCT_MOCK_SCENARIOS } from "@/lib/productMockScenarios";

const ROTATE_MS = 5500;
const FADE_MS = 480;

export function ProductShowcaseCarousel() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      <div
        className={`transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
        aria-live="polite"
        aria-atomic
      >
        <ProductMock scenario={scenario} />
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
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                i === index
                  ? "border-coop-accent/40 bg-coop-blue/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-coop-muted hover:border-white/20 hover:text-white"
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
                i === index ? "w-6 bg-coop-accent" : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        {reduceMotion ? (
          <p className="text-center text-[11px] text-coop-muted">
            Motion reduced — select a feature below to browse examples.
          </p>
        ) : (
          <p className="text-center text-xs text-coop-muted">Auto-advances every few seconds · hover to pause</p>
        )}
      </div>
    </div>
  );
}
