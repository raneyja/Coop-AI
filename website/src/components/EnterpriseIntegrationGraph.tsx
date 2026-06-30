"use client";

import { useMemo } from "react";
import {
  Box,
  Cpu,
  FileCode2,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  GitGraph,
  MessageSquare,
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
  sparkles: Cpu,
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
      className="enterprise-graph relative w-full bg-gray-50"
      aria-label="Knowledge graph connecting repositories, code, collaboration tools, and LLM providers to CoopAI"
    >
      <div className="enterprise-graph-dots pointer-events-none absolute inset-0 opacity-80" aria-hidden />

      <div className="relative w-full py-0">
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

            {layout.map((node, i) => {
              const theme = CATEGORY_THEME[node.category];
              const isActive = node.connectionWeight === "active";
              return (
                <path
                  key={node.id}
                  d={connectionPath(node)}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={isActive ? 1.5 : 1}
                  strokeOpacity={isActive ? 0.55 : 0.22}
                  pathLength={1}
                  className={isActive ? "enterprise-graph-path" : undefined}
                  style={{
                    animationDelay: `${0.15 + i * 0.055}s`
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
            <div className="enterprise-graph-hub-ring flex h-full items-center justify-center rounded-sm border-2 border-coop-index bg-white px-4 font-mono">
              <p className="whitespace-nowrap text-[1.65cqw] font-semibold text-gray-900">
                coop<span className="text-coop-index">index</span>
              </p>
            </div>
          </div>
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
        className="group flex h-full w-full items-stretch overflow-hidden rounded-sm border border-gray-200 bg-white transition duration-200 hover:border-gray-300"
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
          <p className="whitespace-nowrap text-[1.3cqw] font-medium leading-tight text-gray-900">{node.label}</p>
          <p className="mt-0.5 whitespace-nowrap text-[1.05cqw] leading-snug text-[#9ca4ad]">
            {node.categoryLabel}
          </p>
        </div>
      </div>
    </button>
  );
}
