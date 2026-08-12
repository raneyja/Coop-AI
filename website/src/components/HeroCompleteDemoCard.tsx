"use client";

export type HeroCompletePhase = "typing" | "ghost" | "tab-ready" | "tab-press" | "accepted";

type HeroCompleteDemoCardProps = {
  file: string;
  /** Lines above the cursor (already in the file). */
  prefixLines: string[];
  /** Text the user has already typed on the cursor line. */
  typedPrefix: string;
  /** Ghost suggestion (may include newlines). */
  ghostSuffix: string;
  /** How many ghost characters are revealed. */
  revealedGhostChars: number;
  phase: HeroCompletePhase;
};

export function HeroCompleteDemoCard({
  file,
  prefixLines,
  typedPrefix,
  ghostSuffix,
  revealedGhostChars,
  phase
}: HeroCompleteDemoCardProps) {
  const accepted = phase === "accepted";
  const showTab = phase === "tab-ready" || phase === "tab-press" || phase === "accepted";
  const visibleGhost = accepted ? ghostSuffix : ghostSuffix.slice(0, revealedGhostChars);
  const showCursor = phase === "typing" || phase === "ghost" || phase === "tab-ready";

  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
      role="img"
      aria-label={
        accepted
          ? `Completion accepted in ${file}`
          : `Inline completion ready in ${file}. Tab to accept`
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="text-base font-semibold text-gray-900">
          {accepted ? "Completion accepted" : "Completion ready"}
        </h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            accepted ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {accepted ? "Accepted" : "Ghost text"}
        </span>
        <span className="text-xs text-gray-500">graph · AuthError · 3 callers</span>
      </div>

      <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
        {accepted
          ? "Suggestion applied at your cursor. Stay in the file."
          : "Matched AuthError from billing/auth. Tab to accept ghost text."}
      </p>

      <div className="border-b border-gray-100 px-4 py-2">
        <div className="overflow-hidden rounded-md border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5">
            <span className="truncate font-mono text-[11px] text-gray-700">{file}</span>
            <span className="shrink-0 font-mono text-[10px] text-gray-400">inline complete</span>
          </div>
          <pre className="overflow-x-auto bg-white px-3 py-2 font-mono text-[11px] leading-[1.55] text-gray-800">
            {prefixLines.map((line, i) => (
              <div key={`p-${i}`} className="flex gap-2">
                <span className="w-5 shrink-0 select-none text-right text-gray-400">{i + 1}</span>
                <span className="min-w-0 whitespace-pre">{line || " "}</span>
              </div>
            ))}
            <div className="flex gap-2">
              <span className="w-5 shrink-0 select-none text-right text-gray-400">
                {prefixLines.length + 1}
              </span>
              <span className="min-w-0 whitespace-pre">
                <span className="text-gray-800">{typedPrefix}</span>
                {visibleGhost ? (
                  <span
                    className={
                      accepted
                        ? "text-gray-800"
                        : "text-gray-400 [text-shadow:0_0_0.5px_rgba(156,163,175,0.8)]"
                    }
                  >
                    {visibleGhost}
                  </span>
                ) : null}
                {showCursor ? (
                  <span className="hero-demo-response-cursor text-blue-500">|</span>
                ) : null}
              </span>
            </div>
          </pre>
        </div>
      </div>

      {showTab ? (
        <div className="relative flex items-center gap-3 px-4 py-3">
          <div className="relative inline-flex">
            <kbd
              className={`inline-flex min-w-[3.25rem] items-center justify-center rounded-md border px-3 py-2 font-mono text-sm font-semibold tracking-wide transition-transform duration-150 ${
                accepted
                  ? "border-emerald-600 bg-emerald-700 text-white"
                  : phase === "tab-press"
                    ? "scale-95 border-gray-800 bg-gray-800 text-white"
                    : "border-gray-300 bg-gray-50 text-gray-800 shadow-sm"
              }`}
              aria-hidden
            >
              {accepted ? "Tab ✓" : "Tab"}
            </kbd>
            {phase === "tab-ready" || phase === "tab-press" ? (
              <span
                className={`hero-patch-pointer pointer-events-none absolute left-[55%] top-[60%] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gray-900 bg-white ${
                  phase === "tab-press" ? "hero-patch-pointer-press" : "hero-patch-pointer-aim"
                }`}
                aria-hidden
              />
            ) : null}
          </div>
          <span className="text-xs text-gray-500">
            {accepted ? "Ghost text accepted · undo anytime" : "Press Tab to accept"}
          </span>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="h-9 w-16 animate-pulse rounded-md bg-gray-100" aria-hidden />
        </div>
      )}
    </div>
  );
}

export const HERO_COMPLETE_PREFIX_LINES = [
  "import { AuthError } from './errors';",
  "",
  "export async function validateSession(payload: JwtPayload) {",
  "  // Validates signature before route handlers"
];

export const HERO_COMPLETE_TYPED_PREFIX = "  if (!payload?.signature";
export const HERO_COMPLETE_GHOST_SUFFIX =
  " || !payload?.exp) {\n    throw new AuthError('empty_or_unsigned_payload');\n  }";
