import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";

const WITHOUT = [
  "Agents rewriting trees they have barely read",
  "Greenfield demos that skip your production paths",
  "Answers from the open file, with no Slack, tickets, or owners",
  "Suggestions that don't match how your org ships code"
] as const;

const WITH_STACK = [
  { source: "Symbol graph", detail: "Dependents, callers, real types" },
  { source: "GitHub / GitLab", detail: "PRs, blame, the pattern that shipped" },
  { source: "Slack & tickets", detail: "Why the decision was made" },
  { source: "CODEOWNERS", detail: "Who to loop in before you merge" }
] as const;

/**
 * Homepage market-problem section: enterprises need stack-wide context,
 * not agents that generate without knowing the repo or the org.
 */
export function HomeStackContextSection() {
  return (
    <section className="coop-grid-band overflow-hidden border-t border-coop-border py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label="the_gap"
          title="Your team doesn't need another coding agent"
          description="They need AI that already knows the repo, the tickets, and the people who own the code."
        />

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-gray-700 md:text-lg">
          Most copilots only see the file you have open. Agents will happily rewrite a tree they
          don't understand. That's a demo, not how you ship production software.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-gray-700 md:text-lg">
          The hard part isn't generating code. It's having the same context a senior engineer would
          pull from Slack, Jira, CODEOWNERS, and the last few PRs{" "}
          <span className="font-medium text-gray-900">before they touch a line</span>.
        </p>

        <div className="mt-14 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="relative overflow-hidden rounded-2xl border border-coop-border bg-white p-6 md:p-8">
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

          <div className="relative overflow-hidden rounded-2xl border border-coop-index bg-gray-900 p-6 text-white md:p-8">
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-coop-index/25 blur-3xl"
              aria-hidden
            />
            <p className="relative font-mono text-xs uppercase tracking-wide text-coop-index">
              With CoopAI
            </p>
            <h3 className="relative mt-3 text-xl font-semibold tracking-tight">
              Know the stack. Stay in the file.
            </h3>
            <p className="relative mt-3 text-sm leading-relaxed text-gray-300">
              Ask, complete, and edit with the same graph your team already uses. No greenfield toy.
              Nothing chewing through the tree on its own.
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
            How it works is the loop: index the code, query tools live, then ask, complete, and edit
            in VS Code. Product walks through Ask, Change, and Indexed.
          </p>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              How CoopAI works →
            </Link>
            <Link
              href="/product"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              Explore the product →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
