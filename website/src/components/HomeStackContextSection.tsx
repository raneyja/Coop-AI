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

type HomeStackContextSectionProps = {
  tone?: "light" | "dark";
};

/**
 * Homepage market-problem section: enterprises need stack-wide context,
 * not agents that generate without knowing the repo or the org.
 */
export function HomeStackContextSection({ tone = "light" }: HomeStackContextSectionProps) {
  const dark = tone === "dark";

  return (
    <section
      className={
        dark
          ? "overflow-hidden border-t border-white/10 py-20 md:py-28"
          : "coop-grid-band overflow-hidden border-t border-coop-border py-20 md:py-28"
      }
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          tone={tone}
          label="the_gap"
          title="Your team doesn't need another coding agent"
          description="They need AI that already knows the repo, the tickets, and the people who own the code."
        />

        <p
          className={`mt-6 max-w-2xl text-base leading-relaxed md:text-lg ${
            dark ? "text-white/55" : "text-gray-700"
          }`}
        >
          Most copilots only see the file you have open. Agents will happily rewrite a tree they
          don&apos;t understand. That&apos;s a demo, not how you ship production software.
        </p>
        <p
          className={`mt-4 max-w-2xl text-base leading-relaxed md:text-lg ${
            dark ? "text-white/55" : "text-gray-700"
          }`}
        >
          The hard part isn&apos;t generating code. It&apos;s having the same context a senior engineer would
          pull from Slack, Jira, CODEOWNERS, and the last few PRs{" "}
          <span className={`font-medium ${dark ? "text-white" : "text-gray-900"}`}>
            before they touch a line
          </span>
          .
        </p>

        <div className="mt-14 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div
            className={
              dark
                ? "relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8"
                : "relative overflow-hidden rounded-2xl border border-coop-border bg-white p-6 md:p-8"
            }
          >
            <p
              className={`font-mono text-xs uppercase tracking-wide ${
                dark ? "text-white/35" : "text-gray-400"
              }`}
            >
              Without stack context
            </p>
            <h3
              className={`mt-3 text-xl font-semibold tracking-tight ${
                dark ? "text-white" : "text-gray-900"
              }`}
            >
              Fast, shallow, and risky
            </h3>
            <ul className="mt-6 space-y-4">
              {WITHOUT.map((line) => (
                <li
                  key={line}
                  className={`flex gap-3 text-sm leading-relaxed ${
                    dark ? "text-white/50" : "text-coop-muted"
                  }`}
                >
                  <span
                    className={
                      dark
                        ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[10px] text-white/45"
                        : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 font-mono text-[10px] text-gray-500"
                    }
                    aria-hidden
                  >
                    ×
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-coop-index/40 bg-coop-index/10 p-6 text-white md:p-8">
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
            <p className="relative mt-3 text-sm leading-relaxed text-white/65">
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
                  <span className="text-right text-sm text-white/45">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className={`mt-12 flex flex-col items-start justify-between gap-4 border-t pt-10 sm:flex-row sm:items-center ${
            dark ? "border-white/10" : "border-coop-border"
          }`}
        >
          <p className={`max-w-xl text-sm leading-relaxed ${dark ? "text-white/45" : "text-coop-muted"}`}>
            Product walks through Ask, Change, and Indexed: how stack context shows up in questions
            and in the editor.
          </p>
          <Link
            href="/product"
            className={
              dark
                ? "shrink-0 text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline"
                : "shrink-0 text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            }
          >
            Explore the product →
          </Link>
        </div>
      </div>
    </section>
  );
}
