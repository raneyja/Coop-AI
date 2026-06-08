"use client";

import { useEffect, useState } from "react";

const PROMPTS = [
  { prefix: "who owns", target: "auth_middleware.go" },
  { prefix: "complete", target: "token_validator.ts" },
  { prefix: "edit", target: "oauth_refresh.ts" }
] as const;

const ROTATE_MS = 4200;
const FADE_MS = 320;

export function HeroTerminalPrompt() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setVisible(false);
      fadeTimer = setTimeout(() => {
        setIndex((i) => (i + 1) % PROMPTS.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);

    return () => {
      clearInterval(interval);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  const prompt = PROMPTS[index];

  return (
    <div
      className={`coop-panel mx-auto mt-6 hidden max-w-md px-3 py-2 font-mono text-xs text-coop-muted transition-opacity duration-300 lg:mx-0 lg:block ${
        visible ? "opacity-100" : "opacity-40"
      }`}
      aria-live="polite"
    >
      <span className="text-coop-index">$</span> {prompt.prefix}{" "}
      <span className="text-coop-index">{prompt.target}</span>
      <span className="story-cursor ml-0.5 inline-block h-3 w-1.5 bg-coop-index" aria-hidden />
    </div>
  );
}
