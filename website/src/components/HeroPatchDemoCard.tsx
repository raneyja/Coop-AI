"use client";

export type HeroPatchLine = {
  kind: "context" | "remove" | "add";
  n: number;
  text: string;
};

export type HeroPatchPhase = "building" | "ready" | "clicking" | "applied";

type HeroPatchDemoCardProps = {
  file: string;
  meta: string;
  lines: HeroPatchLine[];
  /** How many diff lines are revealed (context always fully visible once building starts). */
  revealedDiffLines: number;
  phase: HeroPatchPhase;
};

function lineClass(kind: HeroPatchLine["kind"], applied: boolean) {
  if (applied && kind === "remove") return "hidden";
  if (applied && kind === "add") return "bg-emerald-50 text-emerald-900";
  if (kind === "remove") return "bg-red-50 text-red-800";
  if (kind === "add") return "bg-emerald-50 text-emerald-900";
  return "text-gray-700";
}

function marker(kind: HeroPatchLine["kind"]) {
  if (kind === "remove") return "−";
  if (kind === "add") return "+";
  return " ";
}

export function HeroPatchDemoCard({
  file,
  meta,
  lines,
  revealedDiffLines,
  phase
}: HeroPatchDemoCardProps) {
  const applied = phase === "applied";
  const showActions = phase === "ready" || phase === "clicking" || phase === "applied";
  const diffLines = lines.filter((l) => l.kind !== "context");
  const visibleDiff = new Set(diffLines.slice(0, revealedDiffLines).map((l) => `${l.kind}:${l.n}:${l.text}`));

  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
      role="img"
      aria-label={
        applied
          ? `Patch applied to ${file}`
          : `Patch ready for ${file}. Review the diff, then apply`
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="text-base font-semibold text-gray-900">
          {applied ? "Patch applied" : "Patch ready"}
        </h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            applied ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {applied ? "Applied" : "Review"}
        </span>
        <span className="text-xs text-gray-500">{meta}</span>
      </div>

      <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
        {applied
          ? "Changes applied to your workspace."
          : "Review the diff below, then apply changes to your workspace."}
      </p>

      <div className="border-b border-gray-100 px-4 py-2">
        <div className="overflow-hidden rounded-md border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5">
            <span className="truncate font-mono text-[11px] text-gray-700">{file}</span>
            <span className="shrink-0 text-[11px] text-blue-500">Open file</span>
          </div>
          <pre className="overflow-x-auto bg-white py-1 font-mono text-[11px] leading-[1.55]">
            {lines.map((line) => {
              const isDiff = line.kind !== "context";
              const key = `${line.kind}:${line.n}:${line.text}`;
              if (isDiff && !visibleDiff.has(key) && !applied) {
                return null;
              }
              if (applied && line.kind === "remove") {
                return null;
              }
              return (
                <div
                  key={key}
                  className={`flex gap-2 px-2 ${lineClass(line.kind, applied)}`}
                >
                  <span className="w-6 shrink-0 select-none text-right text-gray-400">
                    {applied && line.kind === "add" ? line.n : line.n}
                  </span>
                  <span className="w-3 shrink-0 select-none opacity-70">{marker(line.kind)}</span>
                  <span className="min-w-0 whitespace-pre">{line.text || " "}</span>
                </div>
              );
            })}
          </pre>
        </div>
      </div>

      {showActions ? (
        <div className="relative flex items-center gap-3 px-4 py-3">
          <div className="relative inline-flex">
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className={`rounded-md px-3.5 py-2 text-sm font-medium transition-transform duration-150 ${
                applied
                  ? "bg-emerald-700 text-white"
                  : phase === "clicking"
                    ? "scale-95 bg-gray-800 text-white"
                    : "bg-gray-900 text-white"
              }`}
            >
              {applied ? "Applied ✓" : "Apply patch"}
            </button>
            {phase === "clicking" || phase === "ready" ? (
              <span
                className={`hero-patch-pointer pointer-events-none absolute left-[70%] top-[58%] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gray-900 bg-white ${
                  phase === "clicking" ? "hero-patch-pointer-press" : "hero-patch-pointer-aim"
                }`}
                aria-hidden
              />
            ) : null}
          </div>
          {!applied ? (
            <span className="text-sm font-medium text-gray-600">Reject</span>
          ) : (
            <span className="text-xs text-gray-500">Stay in the file · undo anytime</span>
          )}
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="h-9 w-28 animate-pulse rounded-md bg-gray-100" aria-hidden />
        </div>
      )}
    </div>
  );
}

export const HERO_EDIT_PATCH_LINES: HeroPatchLine[] = [
  { kind: "context", n: 42, text: "async function refreshOAuthToken(session: Session) {" },
  { kind: "context", n: 43, text: "  const payload = await buildRefreshPayload(session);" },
  { kind: "remove", n: 44, text: "  if (!payload) return null;" },
  { kind: "add", n: 44, text: "  if (!payload?.refreshToken || !payload?.exp) {" },
  { kind: "add", n: 45, text: "    throw new AuthError('empty_or_unsigned_payload');" },
  { kind: "add", n: 46, text: "  }" },
  { kind: "context", n: 47, text: "  return exchangeToken(payload);" },
  { kind: "context", n: 48, text: "}" }
];

/** PLATFORM-2847 — null guard before validate(), matching api-gateway PR #891. */
export const HERO_JIRA_PATCH_LINES: HeroPatchLine[] = [
  { kind: "context", n: 118, text: "async function handleWebhookAuth(req: Request) {" },
  { kind: "context", n: 119, text: "  const payload = await parseWebhookBody(req);" },
  { kind: "remove", n: 120, text: "  await AuthMiddleware.validate(req);" },
  { kind: "add", n: 120, text: "  if (payload == null) return unauthorized();" },
  { kind: "add", n: 121, text: "  await AuthMiddleware.validate(req);" },
  { kind: "context", n: 122, text: "  return routeWebhook(payload);" },
  { kind: "context", n: 123, text: "}" }
];
