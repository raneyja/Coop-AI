import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";

const WITHOUT = [
  "Autonomous agents rewriting trees they barely understand",
  "Greenfield vibe-coding demos that ignore your production paths",
  "Answers from the open file alone — missing Slack, tickets, and ownership",
                    "Suggestions that don't match how your org actually ships code"
] as const;

const WITH_STACK = [
  { source: "Symbol graph", detail: "Dependents, callers, real types" },
  { source: "GitHub / GitLab", detail: "PRs, blame, the pattern that shipped" },
  { source: "Slack & tickets", detail: "Why the decision was made" },
  { source: "CODEOWNERS", detail: "Who to loop in before you merge" }
] as const;

/**
 * Homepage market-problem section: enterprises need stack-wide context,
 * not vibe-coding agents without deep repo/org knowledge.
 */
export function HomeStackContextSection() {
  return (
    <section className="relative overflow-hidden border-t border-coop-border py-20 md:py-28">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(31,111,235,0.07),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(229,231,235,0.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(229,231,235,0.7)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <SectionHeading
          label="the_gap"
          title="Enterprises don't need another vibe-coding agent"
          description="They need AI that is prescriptive and context-rich — grounded in the codebase and the stack where decisions actually live."
        />

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-gray-700 md:text-lg">
          Generic copilots guess from a buffer. Autonomous agents thrash without knowing your
          auth patterns, owners, or the Jira thread that blocked the last refactor. The hard
          problem isn’t generating code — it’s{" "}
          <span className="font-medium text-gray-900">wiring the entire stack into every answer and every edit</span>.
        </p>

        <div className="mt-14 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="relative overflow-hidden rounded-2xl border border-coop-border bg-white/80 p-6 backdrop-blur-sm md:p-8">
            <p className="font-mono text-xs uppercase tracking-wide text-gray-400">Without stack context</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-gray-900">
              Fast, shallow, and risky
            </h3>
            <ul className="mt-6 space-y-4">
              {WITHOUT.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 font-mono text-[10px] text-gray-500"
                    aria-hidden
                  >
                    ×
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-gray-900 bg-gray-900 p-6 text-white md:p-8">
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-coop-blue/20 blur-3xl"
              aria-hidden
            />
            <p className="relative font-mono text-xs uppercase tracking-wide text-gray-400">
              With CoopAI
            </p>
            <h3 className="relative mt-3 text-xl font-semibold tracking-tight">
              Prescriptive. Context-rich. In the file.
            </h3>
            <p className="relative mt-3 text-sm leading-relaxed text-gray-300">
              Understand, complete, and edit using the same graph your team already trusts —
              not a greenfield toy, not a tree-rewriting agent.
            </p>
            <ul className="relative mt-8 space-y-4">
              {WITH_STACK.map((item) => (
                <li
                  key={item.source}
                  className="flex items-start justify-between gap-4 border-t border-white/10 pt-4 first:border-t-0 first:pt-0"
                >
                  <span className="font-mono text-sm text-white">{item.source}</span>
                  <span className="text-right text-sm text-gray-400">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-coop-border pt-10 sm:flex-row sm:items-center">
          <p className="max-w-xl text-sm leading-relaxed text-coop-muted">
            See Ask, Change, and Indexed — how Coop puts stack context into every question and
            every line you write.
          </p>
          <Link
            href="/product"
            className="shrink-0 text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
          >
            Explore the product →
          </Link>
        </div>
      </div>
    </section>
  );
}
