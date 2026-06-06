"use client";

import type { CodeToken, ProductMockScenario } from "@/lib/productMockScenarios";
import { useChatScrollAnchor } from "@/hooks/useChatScrollAnchor";
import { StoryChatProse } from "./StoryChatProse";
import { StoryComposer } from "./StoryComposer";

const CALLOUT_BORDER = {
  violet: "border-violet-400/30 shadow-violet-500/10",
  amber: "border-amber-400/30 shadow-amber-500/10",
  accent: "border-coop-accent/30 shadow-coop-blue/10"
} as const;

type ProductMockProps = {
  scenario: ProductMockScenario;
  className?: string;
};

export function ProductMock({ scenario, className = "" }: ProductMockProps) {
  const gradientId = `mock-bridge-${scenario.id}`;
  const { containerRef: threadRef, anchorRef: threadAnchorRef } = useChatScrollAnchor([scenario.id]);

  return (
    <div
      className={`relative mx-auto w-full max-w-[52rem] ${className}`}
      role="img"
      aria-label={scenario.ariaLabel}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#1e1e1e] shadow-2xl shadow-black/40 ring-1 ring-[#2a2a2a]">
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
              <div className="max-w-[96%] self-end rounded-xl bg-[#2a2a2a] px-3 py-2.5 ring-1 ring-[#3a3a3a]">
                <p className="text-[13px] leading-relaxed text-[#e5e5e5]">{scenario.question}</p>
              </div>

              <div className="min-w-0 border-l-2 border-coop-accent/55 py-1 pl-3 pr-1">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-[#9d9d9d]">CoopAI</span>
                </div>
                <StoryChatProse content={scenario.answer.content} />
              </div>

              <div ref={threadAnchorRef} className="h-px shrink-0" aria-hidden />
              </div>
            </div>

            <div className="shrink-0 border-t border-[#2a2a2a] px-3 pb-3 pt-2">
              <StoryComposer showComposer={false} typedQuestion="" />
            </div>
          </aside>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e] p-3 font-mono text-[11px] leading-[1.55] md:p-4">
            <div className="min-h-0 flex-1 overflow-hidden">
              {scenario.code.lines.map((line) => (
                <CodeLine key={line.n} n={line.n} tokens={line.tokens} highlight={line.highlight} />
              ))}
            </div>

            <div
              className={`absolute right-2 top-[5.5rem] max-w-[11rem] rounded-md border bg-[#252526]/95 px-2 py-1.5 text-[9px] leading-snug shadow-lg backdrop-blur-sm md:right-4 ${CALLOUT_BORDER[scenario.code.callout.tone]}`}
            >
              <p
                className={
                  scenario.code.callout.tone === "amber"
                    ? "font-medium text-amber-200/95"
                    : scenario.code.callout.tone === "violet"
                      ? "font-medium text-violet-200/95"
                      : "font-medium text-coop-accent"
                }
              >
                {scenario.code.callout.title}
              </p>
              <p className="mt-0.5 text-coop-muted">{scenario.code.callout.subtitle}</p>
              <p className="mt-0.5 text-white/70">{scenario.code.callout.detail}</p>
            </div>
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
            <path
              d="M 318 188 L 318 158 L 355 158 L 355 132"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="1.5"
              strokeOpacity="0.65"
            />
            <circle cx="355" cy="132" r="3" fill="#58A6FF" fillOpacity="0.9" />
            <circle cx="318" cy="188" r="3" fill="#58A6FF" fillOpacity="0.9" />
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
    plain: "text-[#d4d4d4]"
  };

  return (
    <div
      className={`flex gap-2 rounded-sm pr-28 ${highlight ? "bg-coop-accent/10 ring-1 ring-inset ring-coop-accent/35" : ""}`}
    >
      <span className="w-4 shrink-0 select-none text-right text-[#858585]">{n}</span>
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
