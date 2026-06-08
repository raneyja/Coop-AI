"use client";

import {
  Check,
  GitGraph,
  Loader2,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import {
  BitbucketIcon,
  GitHubIcon,
  GitLabIcon,
  JiraIcon,
  SlackIcon,
  type BrandIconProps
} from "./logos/brand-icons";
import type { StorySearchStep } from "@/lib/fileContextStoryScenarios";

const SEARCH_ICONS: Record<
  StorySearchStep["kind"],
  LucideIcon | ((props: BrandIconProps) => ReactNode)
> = {
  graph: GitGraph,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  bitbucket: BitbucketIcon,
  slack: SlackIcon,
  jira: JiraIcon
};

type StorySearchStepListProps = {
  steps: StorySearchStep[];
  activeIndex: number;
  searching?: boolean;
};

export function StorySearchStepList({ steps, activeIndex, searching = false }: StorySearchStepListProps) {
  return (
    <ul className="mt-3 space-y-2">
      {steps.map((step, i) => (
        <SearchStepRow
          key={step.id}
          step={step}
          done={i <= activeIndex}
          active={searching && i === activeIndex}
        />
      ))}
    </ul>
  );
}

function SearchStepRow({
  step,
  done,
  active
}: {
  step: StorySearchStep;
  done: boolean;
  active: boolean;
}) {
  const Icon = SEARCH_ICONS[step.kind];
  return (
    <li
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition ${
        done ? "bg-[#2a2a2a]/80" : "opacity-30"
      } ${active ? "ring-1 ring-coop-index/25" : ""}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {done && !active ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        ) : active ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-coop-index" aria-hidden />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
        )}
      </span>
      <BrandOrLucide Icon={Icon} className="h-3.5 w-3.5 shrink-0 text-white/50" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-white/85">{step.label}</p>
        <p className="truncate text-[10px] text-coop-muted">{step.detail}</p>
      </div>
    </li>
  );
}

function BrandOrLucide({
  Icon,
  className
}: {
  Icon: LucideIcon | ((props: BrandIconProps) => ReactNode);
  className?: string;
}) {
  if (
    Icon === GitHubIcon ||
    Icon === GitLabIcon ||
    Icon === BitbucketIcon ||
    Icon === SlackIcon ||
    Icon === JiraIcon
  ) {
    const Brand = Icon as (props: BrandIconProps) => ReactNode;
    return <Brand className={className} />;
  }
  const Lucide = Icon as LucideIcon;
  return <Lucide className={className} aria-hidden />;
}
