import type { CodeToken, ProductMockScenario } from "@/lib/productMockScenarios";

const STATUS_STYLES = {
  accent: "bg-coop-blue/20 text-coop-accent border-coop-accent/25",
  warning: "bg-amber-500/15 text-amber-200/90 border-amber-500/30",
  success: "bg-emerald-500/15 text-emerald-200/90 border-emerald-500/30",
  violet: "bg-violet-500/15 text-violet-200/90 border-violet-500/30"
} as const;

const CARD_BORDER = {
  accent: "border-coop-accent/25 bg-coop-blue/[0.08] shadow-[0_0_24px_rgba(88,166,255,0.12)]",
  warning: "border-amber-500/25 bg-amber-500/[0.06] shadow-[0_0_24px_rgba(245,158,11,0.08)]",
  success: "border-emerald-500/25 bg-emerald-500/[0.06]",
  violet: "border-violet-400/25 bg-violet-500/[0.06] shadow-[0_0_24px_rgba(167,139,250,0.08)]"
} as const;

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
  const tone = scenario.response.statusTone;
  const gradientId = `mock-bridge-${scenario.id}`;

  return (
    <div
      className={`relative mx-auto w-full max-w-[52rem] ${className}`}
      role="img"
      aria-label={scenario.ariaLabel}
    >
      <div className="rounded-2xl border border-white/10 bg-coop-surface/90 p-2 shadow-2xl shadow-black/30">
        <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0d1117]">
          <div className="flex items-center gap-3 border-b border-white/5 bg-[#161b22] px-3 py-2">
            <div className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex min-w-0 flex-1 gap-1 overflow-hidden font-mono text-[10px] text-coop-muted">
              <span className="rounded-t border border-b-0 border-white/10 bg-[#0d1117] px-2 py-0.5 text-white/80">
                {scenario.tabs.active}
              </span>
              {scenario.tabs.inactive ? (
                <span className="px-2 py-0.5 opacity-50">{scenario.tabs.inactive}</span>
              ) : null}
            </div>
            <span className="font-mono text-[9px] text-coop-muted/80">CoopAI</span>
          </div>

          <div className="relative flex min-h-[300px] flex-col md:min-h-[320px] md:flex-row">
            <aside className="relative z-10 flex w-full shrink-0 flex-col border-b border-white/5 bg-[#0d1117] md:w-[42%] md:border-b-0 md:border-r">
              <div className="border-b border-white/5 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-coop-muted">CoopAI</p>
              </div>

              <div className="flex flex-1 flex-col gap-3 p-3 text-xs">
                <div className="rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
                  <p className="text-[10px] font-medium text-coop-muted">You</p>
                  <p className="mt-1 leading-relaxed text-white/90">{scenario.question}</p>
                </div>

                <div className={`rounded-lg border p-2.5 ${CARD_BORDER[tone]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-semibold text-white">{scenario.response.title}</p>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${STATUS_STYLES[tone]}`}
                    >
                      {scenario.response.status}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-coop-muted">{scenario.response.meta}</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/85">{scenario.response.summary}</p>

                  {scenario.response.sections?.map((section) => (
                    <div key={section.label} className="mt-2.5 space-y-1">
                      <p className="text-[9px] font-medium uppercase tracking-wide text-coop-muted">
                        {section.label}
                      </p>
                      {section.lines.map((line) => (
                        <p key={line} className="text-[10px] text-white/80">
                          {line.includes("@") ? (
                            <>
                              <span className="text-coop-accent">{line.split(" · ")[0]}</span>
                              {line.includes(" · ") ? (
                                <span className="text-coop-muted"> · {line.split(" · ").slice(1).join(" · ")}</span>
                              ) : null}
                            </>
                          ) : (
                            line
                          )}
                        </p>
                      ))}
                    </div>
                  ))}

                  {scenario.response.badges && scenario.response.badges.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {scenario.response.badges.map((badge) => (
                        <Badge key={badge.label} tone={badge.tone}>
                          {badge.label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="relative min-w-0 flex-1 bg-[#0d1117] p-3 font-mono text-[11px] leading-[1.55] md:p-4">
              {scenario.code.lines.map((line) => (
                <CodeLine key={line.n} n={line.n} tokens={line.tokens} highlight={line.highlight} />
              ))}

              <div
                className={`absolute right-2 top-[5.5rem] max-w-[11rem] rounded-md border bg-[#161b22]/95 px-2 py-1.5 text-[9px] leading-snug shadow-lg backdrop-blur-sm md:right-4 ${CALLOUT_BORDER[scenario.code.callout.tone]}`}
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
    </div>
  );
}

function Badge({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "amber" | "muted" | "accent" | "violet";
}) {
  const styles = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200/90",
    muted: "border-white/10 bg-white/5 text-coop-muted",
    accent: "border-coop-accent/25 bg-coop-blue/10 text-coop-accent",
    violet: "border-violet-400/30 bg-violet-500/10 text-violet-200/90"
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] ${styles[tone]}`}>{children}</span>
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
    keyword: "text-[#ff7b72]",
    fn: "text-[#d2a8ff]",
    type: "text-[#79c0ff]",
    string: "text-[#a5d6ff]",
    comment: "text-[#8b949e]",
    plain: "text-[#e6edf3]/90"
  };

  return (
    <div
      className={`flex gap-2 rounded-sm pr-28 ${highlight ? "bg-coop-accent/10 ring-1 ring-inset ring-coop-accent/35" : ""}`}
    >
      <span className="w-4 shrink-0 select-none text-right text-[#6e7681]">{n}</span>
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
