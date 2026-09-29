import { SectionHeading } from "@/components/SectionHeading";

const WITHOUT = [
  "Agents rewriting trees they have barely read",
  "Greenfield demos that skip your production paths",
  "Answers from the open file, with no Slack, tickets, or owners",
  "Suggestions that don't match how your org ships code"
] as const;

const WITH_STACK = [
  {
    source: "Callers, dependents, real types",
    detail: "See what this symbol touches before you change it."
  },
  {
    source: "The change that actually shipped",
    detail: "PRs, blame, and the pattern your team already merged — not a guessed rewrite."
  },
  {
    source: "Company Slack and tickets",
    detail: "Ask against the workspace your admin connected, not each person’s private DMs."
  },
  {
    source: "Find the owner before you open the PR",
    detail: "CODEOWNERS and ownership history in the editor, before merge."
  },
  {
    source: "See what else breaks",
    detail: "Blast radius of the change, while you are still in the file."
  }
] as const;

const JTBD_ROLES = [
  {
    label: "New hire",
    body: "Spends the first month asking who owns what."
  },
  {
    label: "Staff engineer",
    body: "Answers the same Slack questions every week."
  },
  {
    label: "Anyone changing a module",
    body: "Cannot see blast radius, last PRs, or the ticket that created the design."
  }
] as const;

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Admin connects the stack",
    body: "GitHub or GitLab, Slack, Jira, and the rest of the workspace — once, for the org."
  },
  {
    step: "2",
    title: "Index stays on your side",
    body: "Ownership, history, and repo metadata are indexed on your infrastructure. Developers do not clone the monorepo onto every laptop to understand it."
  },
  {
    step: "3",
    title: "Ask, complete, and edit in VS Code",
    body: "Answers cite the PR, ticket, owner, or thread. Edits stay in the file."
  }
] as const;

type HomeStackContextSectionProps = {
  tone?: "light" | "dark";
};

/**
 * Homepage JTBD + comparison: context tax, then Without / With CoopAI, then how it works.
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
          label="The problem"
          title="The tax is not writing code. It's finding the correct context."
          description="Most teams already have a coding assistant. They still lose hours reconstructing ownership, history, and intent from Slack, tickets, and hallway questions."
        />

        <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-6">
          {JTBD_ROLES.map((role) => (
            <div
              key={role.label}
              className={
                dark
                  ? "rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6"
                  : "rounded-2xl border border-coop-border bg-white p-5 md:p-6"
              }
            >
              <p
                className={`font-mono text-xs uppercase tracking-wide ${
                  dark ? "text-white/35" : "text-gray-400"
                }`}
              >
                {role.label}
              </p>
              <p
                className={`mt-3 text-sm leading-relaxed ${
                  dark ? "text-white/65" : "text-gray-700"
                }`}
              >
                {role.body}
              </p>
            </div>
          ))}
        </div>

        <p
          className={`mt-8 max-w-3xl text-base leading-relaxed md:text-lg ${
            dark ? "text-white/55" : "text-gray-700"
          }`}
        >
          CoopAI indexes ownership, history, and live Slack/Jira, then lets you ask, complete, and
          edit in VS Code with that context in the file.
        </p>

        <p
          className={`mt-6 max-w-3xl text-base leading-relaxed md:text-lg ${
            dark ? "text-white/55" : "text-gray-700"
          }`}
        >
          Your team does not need another coding agent. Copilot, Codex, and Cursor already write
          lines. CoopAI is the layer that already knows the repo, the tickets, and the people who
          own the code, so the edit you make is grounded in how this organization actually ships.
        </p>

        <div id="product" className="mt-14 scroll-mt-24 grid gap-6 lg:grid-cols-2 lg:gap-8">
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
              Know the stack. Stay in the file. Ask, complete, and edit.
            </h3>
            <ul className="relative mt-8 space-y-4">
              {WITH_STACK.map((item) => (
                <li
                  key={item.source}
                  className="flex flex-col gap-1 border-t border-white/10 pt-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <span className="font-mono text-sm text-white">{item.source}</span>
                  <span className="text-sm text-white/45 sm:max-w-[55%] sm:text-right">
                    {item.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className={`mt-14 border-t pt-10 ${dark ? "border-white/10" : "border-coop-border"}`}
        >
          <h3
            className={`text-lg font-semibold tracking-tight ${
              dark ? "text-white" : "text-gray-900"
            }`}
          >
            How it works
          </h3>
          <div className="mt-8 grid gap-6 md:grid-cols-3 md:gap-8">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step}>
                <p
                  className={`font-mono text-xs uppercase tracking-wide ${
                    dark ? "text-white/35" : "text-gray-400"
                  }`}
                >
                  Step {item.step}
                </p>
                <h4
                  className={`mt-2 text-base font-semibold ${
                    dark ? "text-white" : "text-gray-900"
                  }`}
                >
                  {item.title}
                </h4>
                <p
                  className={`mt-2 text-sm leading-relaxed ${
                    dark ? "text-white/50" : "text-coop-muted"
                  }`}
                >
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
