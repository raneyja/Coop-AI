"use client";

import { useMemo } from "react";
import {
  Box,
  FileCode2,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  GitGraph,
  MessageSquare,
  Sparkles,
  SquareCode,
  Ticket,
  type LucideIcon
} from "lucide-react";
import {
  categoryAngleRanges,
  categoryArcPath,
  CATEGORY_THEME,
  computeGraphLayout,
  connectionPath,
  GRAPH_HUB,
  HUB_CARD,
  nodeCenter,
  NODE_CARD,
  heightPct,
  widthPct,
  type GraphCategory,
  type GraphNodeDef,
  type LaidOutNode,
  VIEW_H,
  VIEW_W
} from "@/lib/enterpriseGraphLayout";

const ICONS: Record<GraphNodeDef["icon"], LucideIcon> = {
  github: GitGraph,
  gitlab: FolderGit2,
  bitbucket: Box,
  slack: MessageSquare,
  jira: Ticket,
  sparkles: Sparkles,
  vscode: SquareCode,
  fileCode: FileCode2,
  folder: FolderOpen,
  gitCommit: GitCommitHorizontal
};

export function EnterpriseIntegrationGraph() {
  const layout = useMemo(() => computeGraphLayout(), []);
  const categoryArcs = useMemo(() => categoryAngleRanges(layout), [layout]);
  const zoneOuterR = useMemo(() => Math.max(...layout.map((n) => n.radius)) + 36, [layout]);

  const hubTopPct = (GRAPH_HUB.y / VIEW_H) * 100;
  const hubLeftPct = (GRAPH_HUB.x / VIEW_W) * 100;

  return (
    <div
      className="enterprise-graph relative w-full bg-[#0f1117]"
      aria-label="Knowledge graph connecting repositories, code, collaboration tools, and LLM providers to CoopAI"
    >
      <div className="enterprise-graph-dots pointer-events-none absolute inset-0 opacity-80" aria-hidden />

      <div className="relative w-full py-4 sm:py-6">
        <div
          className="enterprise-graph-canvas relative mx-auto w-full"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <defs>
              <marker
                id="graph-arrow"
                markerWidth="7"
                markerHeight="7"
                refX="5.5"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" fill="#58A6FF" fillOpacity="0.7" />
              </marker>
              <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#58A6FF" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#58A6FF" stopOpacity="0" />
              </radialGradient>
            </defs>

            {categoryArcs.map((arc) => (
              <path
                key={arc.category}
                d={categoryArcPath(GRAPH_HUB.x, GRAPH_HUB.y, 108, zoneOuterR, arc.start, arc.end)}
                fill={CATEGORY_THEME[arc.category].zone}
                stroke={CATEGORY_THEME[arc.category].accent}
                strokeOpacity={0.08}
                strokeWidth="1"
              />
            ))}

            <circle cx={GRAPH_HUB.x} cy={GRAPH_HUB.y} r="88" fill="url(#hub-glow)" />

            {layout.map((node, i) => {
              const theme = CATEGORY_THEME[node.category];
              const isActive = node.connectionWeight === "active";
              return (
                <path
                  key={node.id}
                  d={connectionPath(node)}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={isActive ? 2 : 1.15}
                  strokeOpacity={isActive ? 0.45 : 0.28}
                  markerEnd="url(#graph-arrow)"
                  pathLength={1}
                  className="enterprise-graph-path"
                  style={{
                    animationDelay: `${0.15 + i * 0.055}s`,
                    ["--path-pulse-opacity" as string]: isActive ? "0.55" : "0.35"
                  }}
                />
              );
            })}
          </svg>

          {layout.map((node, i) => (
            <GraphNodeCard key={node.id} node={node} staggerIndex={i} stackOrder={i} />
          ))}

          <div
            className="enterprise-graph-hub absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${hubLeftPct}%`,
              top: `${hubTopPct}%`,
              width: `${widthPct(HUB_CARD.width)}%`,
              height: `${heightPct(HUB_CARD.height)}%`,
              animationDelay: "0.05s"
            }}
          >
            <div className="enterprise-graph-hub-ring relative flex h-full items-center justify-center rounded-xl border border-coop-accent/50 bg-[#1a1d27] px-3 shadow-[0_0_48px_rgba(88,166,255,0.22)]">
              <div className="pointer-events-none absolute -inset-1 rounded-xl bg-coop-accent/10 blur-md" aria-hidden />
              <p className="relative whitespace-nowrap text-[1.45cqw] font-semibold tracking-tight text-white">
                CoopAI
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 px-4">
          {(Object.keys(CATEGORY_THEME) as GraphCategory[]).map((cat) => (
            <span key={cat} className="flex items-center gap-2 text-[11px] text-[#9ca4ad]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_THEME[cat].accent }}
                aria-hidden
              />
              {CATEGORY_THEME[cat].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GraphNodeCard({
  node,
  staggerIndex,
  stackOrder
}: {
  node: LaidOutNode;
  staggerIndex: number;
  stackOrder: number;
}) {
  const { x, y } = nodeCenter(node);
  const theme = CATEGORY_THEME[node.category];
  const Icon = ICONS[node.icon];
  const delay = 0.12 + staggerIndex * 0.05;
  const iconRailPct = (40 / node.cardWidth) * 100;

  return (
    <button
      type="button"
      className="enterprise-graph-node absolute -translate-x-1/2 -translate-y-1/2 text-left hover:z-30 focus-visible:z-30"
      style={{
        left: `${(x / VIEW_W) * 100}%`,
        top: `${(y / VIEW_H) * 100}%`,
        width: `${widthPct(node.cardWidth)}%`,
        height: `${heightPct(NODE_CARD.height)}%`,
        zIndex: 10 + stackOrder,
        animationDelay: `${delay}s`
      }}
      aria-label={`${node.label} — ${node.categoryLabel}`}
    >
      <div
        className="group flex h-full w-full items-stretch overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1d27] shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_12px_32px_rgba(0,0,0,0.45)] hover:ring-2 hover:ring-white/10"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: theme.accent
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center border-r border-white/[0.06] bg-[#14171f]"
          style={{ width: `${iconRailPct}%`, color: theme.accent }}
        >
          <Icon className="h-[42%] w-[42%] min-h-[12px] min-w-[12px] stroke-[1.75]" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center px-[5%] py-[6%]">
          <p className="whitespace-nowrap text-[1.3cqw] font-medium leading-tight text-white">{node.label}</p>
          <p className="mt-0.5 whitespace-nowrap text-[1.05cqw] leading-snug text-[#9ca4ad]">
            {node.categoryLabel}
          </p>
        </div>
      </div>
    </button>
  );
}
