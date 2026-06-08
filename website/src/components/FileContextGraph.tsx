"use client";

import {
  BookOpen,
  GitCommitHorizontal,
  GitGraph,
  AlertTriangle,
  Server,
  UserCheck,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GitHubIcon,
  JiraIcon,
  NotionIcon,
  SlackIcon,
  type BrandIconProps
} from "./logos/brand-icons";
import {
  FILE_CONTEXT_SCENARIOS,
  type FileContextScenario,
  type OrbitNodeKind
} from "@/lib/fileContextScenarios";
import {
  FILE_CARD,
  FILE_HUB,
  ORBIT_THEME,
  VIEW_H,
  VIEW_W,
  heightPct,
  layoutOrbitNodes,
  orbitConnectionPath,
  widthPct,
  type LaidOutOrbitNode
} from "@/lib/fileContextGraphLayout";

const FEATURE_TONE: Record<FileContextScenario["feature"], string> = {
  "Trace Decision": "text-coop-index border-coop-index/40 bg-coop-index/10",
  "Blast Radius": "text-amber-300 border-amber-400/40 bg-amber-400/10",
  "Knowledge Gaps": "text-coop-warn border-coop-warn/40 bg-coop-warn/10",
  "Understand Repo": "text-emerald-300 border-emerald-400/40 bg-emerald-400/10"
};

const ORBIT_ICONS: Record<
  OrbitNodeKind,
  LucideIcon | ((props: BrandIconProps) => ReactNode)
> = {
  github: GitHubIcon,
  slack: SlackIcon,
  jira: JiraIcon,
  commits: GitCommitHorizontal,
  docs: BookOpen,
  graph: GitGraph,
  gap: AlertTriangle,
  notion: NotionIcon,
  codeowners: UserCheck,
  services: Server
};

const CYCLE_MS = 3600;

type FileContextGraphProps = {
  /** Start on a specific scenario id */
  initialScenarioId?: string;
  className?: string;
  /** Sidebar layout — graph only, no file picker or detail panels */
  compact?: boolean;
};

export function FileContextGraph({
  initialScenarioId = FILE_CONTEXT_SCENARIOS[0].id,
  className = "",
  compact = false
}: FileContextGraphProps) {
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [fileFocused, setFileFocused] = useState(false);
  const [hoveredOrbitId, setHoveredOrbitId] = useState<string | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [disabledSources, setDisabledSources] = useState<Set<string>>(new Set());

  const scenario = useMemo(
    () => FILE_CONTEXT_SCENARIOS.find((s) => s.id === scenarioId) ?? FILE_CONTEXT_SCENARIOS[0],
    [scenarioId]
  );

  const orbitNodes = useMemo(() => layoutOrbitNodes(scenario), [scenario]);

  const revealOrbits = fileFocused || hoveredOrbitId !== null;

  const activeOrbitId =
    hoveredOrbitId ?? (revealOrbits ? orbitNodes[cycleIndex % orbitNodes.length]?.id : null);

  const enabledPacket = scenario.contextPacket.filter((row) => !disabledSources.has(row.id));
  const grounded =
    disabledSources.size === 0 ||
    !scenario.contextPacket.some((r) => r.toggleable && disabledSources.has(r.id));

  const switchScenario = useCallback((id: string) => {
    if (id === scenarioId) return;
    setTransitioning(true);
    setHoveredOrbitId(null);
    setDisabledSources(new Set());
    setCycleIndex(0);
    window.setTimeout(() => {
      setScenarioId(id);
      setTransitioning(false);
    }, 180);
  }, [scenarioId]);

  const toggleSource = useCallback((id: string) => {
    setDisabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (fileFocused || hoveredOrbitId) return;
    const timer = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % orbitNodes.length);
    }, CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [fileFocused, hoveredOrbitId, orbitNodes.length, scenarioId]);

  const hubLeftPct = (FILE_HUB.x / VIEW_W) * 100;
  const hubTopPct = (FILE_HUB.y / VIEW_H) * 100;

  return (
    <div className={`file-context-graph ${compact ? "flex h-full min-h-0 flex-col" : ""} ${className}`.trim()}>
      {/* File picker */}
      {!compact && (
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {FILE_CONTEXT_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => switchScenario(s.id)}
            className={`rounded-sm border px-3.5 py-1.5 font-mono text-xs transition md:text-sm ${
              s.id === scenarioId
                ? "border-coop-index/50 bg-coop-index/10 text-white"
                : "border-coop-border bg-coop-editor text-white/60 hover:border-coop-muted/50 hover:text-white/85"
            }`}
          >
            {s.file.name}
          </button>
        ))}
      </div>
      )}

      {/* Desktop graph */}
      <div
        className={`file-context-graph-stage relative overflow-hidden border border-coop-border bg-[#0f1117] ${
          compact ? "h-full min-h-[18rem] flex-1 rounded-sm" : "hidden rounded-sm md:block"
        } ${
          transitioning ? "opacity-60" : "opacity-100"
        } transition-opacity duration-200`}
        aria-label={`Context sources linked to ${scenario.file.name}`}
      >
        <div className="enterprise-graph-dots pointer-events-none absolute inset-0 opacity-70" aria-hidden />

        <div
          className={`file-context-graph-canvas relative ${
            compact ? "absolute inset-0 h-full w-full" : "mx-auto w-full"
          }`}
          style={compact ? undefined : { aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio={compact ? "xMidYMid slice" : "xMidYMid meet"}
            aria-hidden
          >
            <defs>
              {!compact && (
              <radialGradient id="file-hub-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#79C0FF" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#79C0FF" stopOpacity="0" />
              </radialGradient>
              )}
            </defs>

            {!compact && (
            <circle cx={FILE_HUB.x} cy={FILE_HUB.y} r="96" fill="url(#file-hub-glow)" />
            )}

            {orbitNodes.map((node, i) => {
              const theme = ORBIT_THEME[node.kind] ?? ORBIT_THEME.graph;
              const isActive = activeOrbitId === node.id;
              const dimmed = revealOrbits && !isActive;
              return (
                <path
                  key={`${scenarioId}-${node.id}`}
                  d={orbitConnectionPath(node)}
                  fill="none"
                  stroke={node.isGap ? ORBIT_THEME.gap.accent : theme.accent}
                  strokeWidth={isActive ? 2.2 : node.weight === "primary" ? 1.5 : 1.1}
                  strokeOpacity={
                    dimmed ? 0.14 : isActive ? 0.62 : revealOrbits ? 0.38 : 0.22
                  }
                  pathLength={1}
                  className="enterprise-graph-path"
                  style={{
                    animationDelay: `${0.12 + i * 0.06}s`,
                    ["--path-pulse-opacity" as string]: isActive ? "0.65" : "0.4"
                  }}
                />
              );
            })}
          </svg>

          {orbitNodes.map((node, i) => (
            <OrbitNodeCard
              key={`${scenarioId}-${node.id}`}
              node={node}
              staggerIndex={i}
              revealed={revealOrbits}
              active={activeOrbitId === node.id}
              onEnter={() => setHoveredOrbitId(node.id)}
              onLeave={() => setHoveredOrbitId(null)}
            />
          ))}

          <div
            className="file-context-hub absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${hubLeftPct}%`,
              top: `${hubTopPct}%`,
              width: `${widthPct(FILE_CARD.width)}%`,
              height: `${heightPct(FILE_CARD.height)}%`
            }}
            onMouseEnter={() => setFileFocused(true)}
            onMouseLeave={() => setFileFocused(false)}
            onFocus={() => setFileFocused(true)}
            onBlur={() => setFileFocused(false)}
          >
            <div
              className={`relative flex h-full flex-col justify-center rounded-xl border bg-[#1a1d27] px-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)] transition duration-300 ${
                fileFocused
                  ? "border-[#79C0FF]/55 shadow-[0_0_40px_rgba(121,192,255,0.2)]"
                  : "border-[#79C0FF]/30"
              }`}
              style={{ borderLeftWidth: 3, borderLeftColor: "#79C0FF" }}
            >
              <div className="pointer-events-none absolute -inset-1 rounded-xl bg-[#79C0FF]/8 blur-md" aria-hidden />
              <p className="relative truncate font-mono text-[1.55cqw] font-semibold text-white">
                {scenario.file.name}
              </p>
              <p className="relative mt-0.5 truncate font-mono text-[1.05cqw] text-[#9ca4ad]">
                {scenario.file.path}
                {scenario.file.symbol ? ` · ${scenario.file.symbol}` : ""}
              </p>
              <div className="relative mt-1.5 flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.95cqw] text-white/70">
                  {scenario.file.language}
                </span>
                <span className="text-[0.95cqw] text-[#79C0FF]">
                  {scenario.sourceCount} sources linked
                </span>
              </div>
            </div>
          </div>

          {/* VS Code output chip */}
          {!compact && (
          <div
            className="absolute z-10 -translate-x-1/2"
            style={{ left: `${hubLeftPct}%`, top: `${hubTopPct + heightPct(FILE_CARD.height) * 0.72}%` }}
          >
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#14171f]/95 px-3 py-1.5 text-[11px] text-white/55 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-[#3FB950]" aria-hidden />
              Answers in VS Code sidebar
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Mobile list */}
      {!compact && (
      <div className="space-y-3 md:hidden">
        <div
          className="rounded-xl border border-[#79C0FF]/35 bg-[#1a1d27] p-4"
          style={{ borderLeftWidth: 3, borderLeftColor: "#79C0FF" }}
        >
          <p className="font-mono text-sm font-semibold text-white">{scenario.file.name}</p>
          <p className="mt-1 font-mono text-xs text-coop-muted">{scenario.file.path}</p>
          <p className="mt-2 text-xs text-[#79C0FF]">{scenario.sourceCount} sources linked</p>
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/30">
          Sources linked to this file
        </p>
        <ul className="space-y-2">
          {orbitNodes.map((node) => (
            <li
              key={node.id}
              className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5"
            >
              <OrbitIcon kind={node.kind} className="h-4 w-4 shrink-0" active />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{node.label}</p>
                <p className="truncate text-xs text-coop-muted">{node.sublabel}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      )}

      {/* Detail panel */}
      {!compact && (
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ContextPacket
          scenario={scenario}
          rows={enabledPacket}
          grounded={grounded}
          disabledSources={disabledSources}
          onToggle={toggleSource}
        />

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${FEATURE_TONE[scenario.feature]}`}
            >
              {scenario.feature}
            </span>
            {scenario.highlights.map((h) => (
              <span
                key={h}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-white/50"
              >
                {h}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-white/30">
            Example question
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/85">{scenario.exampleQuestion}</p>
          <p className="mt-4 text-xs leading-relaxed text-coop-muted">
            Hover the file node on desktop to reveal all linked sources. Toggle context rows to see
            how grounded answers depend on your stack integrations.
          </p>
        </div>
      </div>
      )}
    </div>
  );
}

function OrbitIcon({
  kind,
  className,
  active
}: {
  kind: OrbitNodeKind;
  className?: string;
  active?: boolean;
}) {
  const theme = ORBIT_THEME[kind] ?? ORBIT_THEME.graph;
  const Icon = ORBIT_ICONS[kind];
  const color = active ? theme.accent : theme.accent;

  if (kind === "github" || kind === "slack" || kind === "jira" || kind === "notion") {
    const BrandIcon = Icon as (props: BrandIconProps) => ReactNode;
    return <BrandIcon className={className} />;
  }

  const Lucide = Icon as LucideIcon;
  return <Lucide className={className} style={{ color }} aria-hidden />;
}

function OrbitNodeCard({
  node,
  staggerIndex,
  revealed,
  active,
  onEnter,
  onLeave
}: {
  node: LaidOutOrbitNode;
  staggerIndex: number;
  revealed: boolean;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const theme = ORBIT_THEME[node.kind] ?? ORBIT_THEME.graph;
  const delay = 0.1 + staggerIndex * 0.05;
  const iconRailPct = (38 / node.cardWidth) * 100;
  const opacity = revealed ? (active ? 1 : 0.72) : 0.38;

  return (
    <button
      type="button"
      className="enterprise-graph-node absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:z-30"
      style={{
        left: `${(node.x / VIEW_W) * 100}%`,
        top: `${(node.y / VIEW_H) * 100}%`,
        width: `${widthPct(node.cardWidth)}%`,
        height: `${heightPct(54)}%`,
        zIndex: active ? 30 : 10 + staggerIndex,
        animationDelay: `${delay}s`,
        opacity,
        transition: "opacity 0.25s ease, transform 0.2s ease"
      }}
      aria-label={`${node.label} — ${node.sublabel}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div
        className={`group flex h-full w-full items-stretch overflow-hidden rounded-sm border bg-[#1a1d27] transition duration-200 hover:border-coop-muted/40 ${
          node.isGap
            ? "border-dashed border-amber-400/45"
            : active
              ? "border-white/20 ring-2 ring-white/10"
              : "border-white/[0.08] hover:border-white/15"
        }`}
        style={{ borderLeftWidth: 3, borderLeftColor: node.isGap ? ORBIT_THEME.gap.accent : theme.accent }}
      >
        <div
          className="flex shrink-0 items-center justify-center border-r border-white/[0.06] bg-[#14171f]"
          style={{ width: `${iconRailPct}%`, color: theme.accent }}
        >
          <OrbitIcon kind={node.kind} className="h-[40%] w-[40%] min-h-[11px] min-w-[11px]" active={active} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center px-[5%] py-[5%]">
          <p className="truncate text-[1.22cqw] font-medium leading-tight text-white">{node.label}</p>
          <p className="mt-0.5 truncate text-[1cqw] leading-snug text-[#9ca4ad]">{node.sublabel}</p>
        </div>
      </div>

      {active && (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-white/10 bg-[#14171f] px-3 py-2 text-center text-[11px] leading-snug text-white/75 shadow-xl"
          role="tooltip"
        >
          {node.tooltip}
        </div>
      )}
    </button>
  );
}

function ContextPacket({
  scenario,
  rows,
  grounded,
  disabledSources,
  onToggle
}: {
  scenario: FileContextScenario;
  rows: FileContextScenario["contextPacket"];
  grounded: boolean;
  disabledSources: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1d27]/80 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-sm font-medium text-white">
          Context packet · {scenario.file.name}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            grounded
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {grounded ? `${rows.length} sources · grounded` : "degraded context"}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {scenario.contextPacket.map((row) => {
          const disabled = disabledSources.has(row.id);
          return (
            <li
              key={row.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                disabled
                  ? "border-white/[0.04] bg-white/[0.01] opacity-45"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] ${
                  disabled ? "bg-white/5 text-white/25" : "bg-emerald-500/20 text-emerald-400"
                }`}
                aria-hidden
              >
                {disabled ? "—" : "✓"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                  {row.source}
                </p>
                <p className="mt-0.5 text-sm text-white/80">{row.detail}</p>
              </div>
              {row.toggleable && (
                <button
                  type="button"
                  onClick={() => onToggle(row.id)}
                  className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/50 transition hover:border-white/25 hover:text-white/80"
                  aria-pressed={!disabled}
                >
                  {disabled ? "Include" : "Exclude"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
