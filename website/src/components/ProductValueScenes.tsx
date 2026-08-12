"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { QuickActionPromptCarousel } from "@/components/QuickActionPromptCarousel";
import { ProductCreationMock } from "@/components/ProductCreationMock";
import { ContextConstellation } from "@/components/ContextConstellation";
import { CODE_CREATION_STORIES } from "@/lib/codeCreationScenarios";

const ASK_COMMANDS = [
  "/understand",
  "/trace",
  "/blast",
  "/owner",
  "/gaps",
  "/jira",
  "/slack"
] as const;

const WRITE_PILLARS = [
  {
    id: "complete",
    title: "Complete",
    body: "Ghost text that pulls dependents, ownership, and team AuthError patterns."
  },
  {
    id: "edit",
    title: "Edit",
    body: "Highlight → describe → reviewable inline diff → accept / retry / undo."
  },
  {
    id: "implement",
    title: "Implement",
    body: "Ticket-driven fixes that match real types, middleware, and linked Jira/Slack decisions."
  }
] as const;

const INDEX_TRUST = [
  {
    title: "Remote knowledge graph",
    body: "Index via webhooks and jobs — ownership, dependents, decisions without a full local clone."
  },
  {
    title: "Cross-tool context",
    body: "Slack, Jira, PRs, and CODEOWNERS sit beside the symbol graph — not trapped in tribal knowledge."
  },
  {
    title: "Honest when incomplete",
    body: "When graph data is missing, Coop says so instead of guessing."
  }
] as const;

/** Scene: Ask — slash commands + rotating prompt/outcome (no feature encyclopedia). */
export function ProductAskScene() {
  return (
    <section className="border-t border-coop-border py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label="ask"
          title="Questions that used to take a Slack archaeology dig"
          description="One place for architecture, owners, blast radius, and the ticket that explains why — across your repo graph and the tools your team already uses."
        />

        <div className="mt-8 flex flex-wrap gap-2" aria-label="Quick action commands">
          {ASK_COMMANDS.map((cmd) => (
            <span
              key={cmd}
              className="rounded-full border border-coop-border bg-white px-3 py-1.5 font-mono text-xs text-gray-800"
            >
              {cmd}
            </span>
          ))}
        </div>

        <div className="mt-12">
          <QuickActionPromptCarousel />
        </div>
      </div>
    </section>
  );
}

/** Scene: Change — live complete/edit mock + three verbs. */
export function ProductChangeScene() {
  const [storyIndex, setStoryIndex] = useState(0);
  const story = CODE_CREATION_STORIES[storyIndex % CODE_CREATION_STORIES.length];

  useEffect(() => {
    // Prefer edit story first so Apply-patch energy matches homepage.
    const editIdx = CODE_CREATION_STORIES.findIndex((s) => s.kind === "edit");
    if (editIdx >= 0) setStoryIndex(editIdx);
  }, []);

  return (
    <section className="border-t border-coop-border bg-gray-50 py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="xl:grid xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-center xl:gap-14">
          <div className="min-w-0">
            <SectionHeading
              label="change"
              title="Write and edit like a teammate who's already in the repo"
              description="Graph-grounded complete and in-file edit — craftsmanship in the editor, not an autonomous agent rewriting your tree."
            />
            <ul className="mt-10 space-y-6">
              {WRITE_PILLARS.map((item) => (
                <li key={item.id}>
                  <p className="font-mono text-sm font-medium text-gray-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-coop-muted">{item.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-xs leading-relaxed text-coop-muted">
              Inline complete uses a separate zero-retention path.{" "}
              <Link href="/docs/autocomplete" className="text-gray-800 underline-offset-2 hover:underline">
                Autocomplete docs
              </Link>
              {" · "}
              <Link href="/docs/edit-mode" className="text-gray-800 underline-offset-2 hover:underline">
                Edit mode
              </Link>
            </p>
          </div>

          <div className="mt-12 h-[28rem] w-full min-w-0 overflow-hidden rounded-2xl ring-1 ring-coop-border xl:mt-0 xl:h-[32rem]">
            <ProductCreationMock
              key={story.id}
              story={story}
              tabs={{
                active: story.activeTab,
                inactive: story.inactiveTab
              }}
              ariaLabel={story.ariaLabel}
              className="h-full !max-w-none !rounded-none !ring-0"
              loop
              onCycleComplete={() =>
                setStoryIndex((i) => (i + 1) % CODE_CREATION_STORIES.length)
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Scene: Indexed — Lightning / deep-index as the substrate story. */
export function ProductIndexedScene() {
  return (
    <section className="border-t border-coop-border py-20 md:py-24" id="lightning-mode">
      <div className="mx-auto max-w-7xl px-6 xl:grid xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:items-center xl:gap-12">
        <div className="min-w-0">
          <SectionHeading
            label="indexed"
            title="Cross-repo context without cloning the monorepo"
            description="Lightning Mode builds a secure knowledge graph so developers get rich AI context across services — instantly, without parking a full tree on every laptop."
          />
          <p className="mt-6 text-sm leading-relaxed text-coop-muted">
            Built for teams with interconnected services where cloning everything isn’t practical.
          </p>
          <p className="mt-4 font-mono text-xs text-gray-700">
            Free: up to 3 Deep-Indexed repos · Pro: unlimited
          </p>
          <dl className="mt-10 space-y-5 border-l border-coop-border pl-4">
            {INDEX_TRUST.map((item) => (
              <div key={item.title}>
                <dt className="font-mono text-sm text-gray-800">{item.title}</dt>
                <dd className="mt-1 text-sm text-coop-muted">{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-10 w-full min-w-0 xl:mt-0">
          <div className="relative mx-auto w-full max-w-full overflow-hidden rounded-2xl ring-1 ring-coop-border aspect-[6/5] sm:aspect-[920/580] sm:max-w-4xl xl:aspect-auto xl:max-w-none xl:h-[34rem]">
            <ContextConstellation className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
