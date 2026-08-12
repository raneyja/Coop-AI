"use client";

import {
  GitCommitHorizontal,
  GitGraph,
  AlertTriangle,
  Server,
  UserCheck,
  type LucideIcon
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  ConfluenceIcon,
  GitHubIcon,
  JiraIcon,
  NotionIcon,
  SlackIcon,
  type BrandIconProps
} from "./logos/brand-icons";
import {
  FILE_CONTEXT_SCENARIOS,
  type OrbitNodeKind
} from "@/lib/fileContextScenarios";
import {
  FILE_HUB,
  HUB_VISUAL,
  ORBIT_THEME,
  VIEW_H,
  VIEW_W,
  constellationContentBounds,
  layoutOrbitNodes,
  orbitConnectionPath,
  type LaidOutOrbitNode
} from "@/lib/fileContextGraphLayout";

const PULSE_MS = 520;
const FLOW_MS = 900;
const LAND_MS = 480;
const BETWEEN_MS = 380;
const HOLD_FULL_MS = 2000;
const SCENARIO_FADE_MS = 520;
/** Below this fit width, pull orbits in tighter for phone readability. */
const COMPACT_FIT_PX = 560;
/** Default orbit pull-in so the cluster fills the frame instead of floating in whitespace. */
const RADIUS_DESKTOP = 0.88;
const RADIUS_COMPACT = 0.78;

type Phase = "pulse" | "flow" | "land" | "between" | "hold" | "fade";

type Chip = {
  id: string;
  label: string;
  kind: OrbitNodeKind;
};

const ORBIT_ICONS: Record<
  OrbitNodeKind,
  LucideIcon | ((props: BrandIconProps) => ReactNode)
> = {
  github: GitHubIcon,
  slack: SlackIcon,
  jira: JiraIcon,
  commits: GitCommitHorizontal,
  docs: ConfluenceIcon,
  graph: GitGraph,
  gap: AlertTriangle,
  notion: NotionIcon,
  codeowners: UserCheck,
  services: Server
};

type ContextConstellationProps = {
  className?: string;
};

/**
 * Homepage Lightning Intelligence visual — context constellation.
 * Design-canvas scaled to fit the container; tools pulse → packets flow → chips ease in.
 */
export function ContextConstellation({ className = "" }: ContextConstellationProps) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);
  const [compact, setCompact] = useState(false);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("pulse");
  const [chips, setChips] = useState<Chip[]>([]);
  const [packetKey, setPacketKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = FILE_CONTEXT_SCENARIOS[scenarioIndex % FILE_CONTEXT_SCENARIOS.length];
  const orbitNodes = useMemo(
    () => layoutOrbitNodes(scenario, compact ? RADIUS_COMPACT : RADIUS_DESKTOP),
    [scenario, compact]
  );
  const contentBounds = useMemo(() => constellationContentBounds(orbitNodes), [orbitNodes]);
  const activeNode =
    activeIndex >= 0 && activeIndex < orbitNodes.length ? orbitNodes[activeIndex] : null;

  // Fill the fit region with the constellation cluster (tight bounds + denser orbits).
  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      setCompact(width < COMPACT_FIT_PX);
      const edge = 2;
      const next = Math.min(
        (width - edge) / contentBounds.width,
        (height - edge) / contentBounds.height
      );
      setScale(Math.min(2.15, Math.max(0.4, next)));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentBounds.width, contentBounds.height]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!reduceMotion) return;
    setChips(
      orbitNodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind
      }))
    );
    setPhase("hold");
    setActiveIndex(-1);
  }, [reduceMotion, orbitNodes]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (fn: () => void, ms: number) => {
      clearTimer();
      timerRef.current = setTimeout(fn, ms);
    },
    [clearTimer]
  );

  useEffect(() => {
    if (reduceMotion) {
      clearTimer();
      return;
    }

    if (phase === "pulse") {
      schedule(() => {
        setPacketKey((k) => k + 1);
        setPhase("flow");
      }, PULSE_MS);
      return;
    }

    if (phase === "flow") {
      schedule(() => setPhase("land"), FLOW_MS);
      return;
    }

    if (phase === "land") {
      const node = orbitNodes[activeIndex];
      if (node) {
        setChips((prev) => {
          if (prev.some((c) => c.id === node.id)) return prev;
          return [...prev, { id: node.id, label: node.label, kind: node.kind }];
        });
      }
      schedule(() => setPhase("between"), LAND_MS);
      return;
    }

    if (phase === "between") {
      const next = activeIndex + 1;
      if (next >= orbitNodes.length) {
        schedule(() => setPhase("hold"), BETWEEN_MS);
      } else {
        schedule(() => {
          setActiveIndex(next);
          setPhase("pulse");
        }, BETWEEN_MS);
      }
      return;
    }

    if (phase === "hold") {
      schedule(() => {
        setFading(true);
        setPhase("fade");
      }, HOLD_FULL_MS);
      return;
    }

    if (phase === "fade") {
      schedule(() => {
        setChips([]);
        setActiveIndex(0);
        setScenarioIndex((i) => (i + 1) % FILE_CONTEXT_SCENARIOS.length);
        setFading(false);
        setPhase("pulse");
      }, SCENARIO_FADE_MS);
    }
  }, [phase, activeIndex, orbitNodes, reduceMotion, schedule, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const activePath = activeNode ? orbitConnectionPath(activeNode) : "";
  const activeTheme = activeNode
    ? ORBIT_THEME[activeNode.kind] ?? ORBIT_THEME.graph
    : ORBIT_THEME.graph;

  return (
    <div
      className={`context-constellation relative flex h-full min-h-[16rem] w-full max-w-full flex-col overflow-hidden rounded-sm border border-coop-border bg-gray-50 ${className}`.trim()}
      aria-label={`${scenario.file.name} gathering context from ${scenario.sourceCount} stack sources`}
    >
      <div className="enterprise-graph-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="context-constellation-glow pointer-events-none absolute inset-0" aria-hidden />

      {/* Fit region — caption is outside so height isn't stolen from the diagram */}
      <div ref={fitRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative shrink-0 overflow-hidden"
            style={{
              width: contentBounds.width * scale,
              height: contentBounds.height * scale
            }}
          >
            <div
              className={`context-constellation-canvas absolute left-0 top-0 transition-opacity ease-in-out ${
                fading ? "opacity-0" : "opacity-100"
              }`}
              style={{
                width: VIEW_W,
                height: VIEW_H,
                transform: `scale(${scale}) translate(${-contentBounds.minX}px, ${-contentBounds.minY}px)`,
                transformOrigin: "top left",
                transitionDuration: `${SCENARIO_FADE_MS}ms`
              }}
            >
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                <div
                  className="context-orbit-ring absolute rounded-full border border-coop-border/70"
                  style={{
                    left: FILE_HUB.x,
                    top: FILE_HUB.y,
                    width: compact ? 280 : 300,
                    height: compact ? 280 : 300,
                    transform: "translate(-50%, -50%)"
                  }}
                />
                <div
                  className="context-orbit-ring context-orbit-ring--slow absolute rounded-full border border-dashed border-coop-border/50"
                  style={{
                    left: FILE_HUB.x,
                    top: FILE_HUB.y,
                    width: compact ? 380 : 400,
                    height: compact ? 380 : 400,
                    transform: "translate(-50%, -50%)"
                  }}
                />
              </div>

              <svg
                className="absolute inset-0"
                width={VIEW_W}
                height={VIEW_H}
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                aria-hidden
              >
                <defs>
                  <radialGradient id="constellation-hub-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#79C0FF" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#79C0FF" stopOpacity="0" />
                  </radialGradient>
                  <filter id="constellation-packet-glow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <circle cx={FILE_HUB.x} cy={FILE_HUB.y} r="100" fill="url(#constellation-hub-glow)" />

                {orbitNodes.map((node) => {
                  const theme = ORBIT_THEME[node.kind] ?? ORBIT_THEME.graph;
                  const isActive =
                    !reduceMotion &&
                    activeNode?.id === node.id &&
                    phase !== "hold" &&
                    phase !== "fade" &&
                    phase !== "between";
                  const landed = chips.some((c) => c.id === node.id);
                  return (
                    <path
                      key={`${scenario.id}-${node.id}`}
                      d={orbitConnectionPath(node)}
                      fill="none"
                      stroke={node.isGap ? ORBIT_THEME.gap.accent : theme.accent}
                      strokeWidth={isActive ? 2.2 : landed ? 1.5 : 1.05}
                      strokeOpacity={isActive ? 0.7 : landed ? 0.36 : 0.14}
                      strokeLinecap="round"
                      style={{ transition: "stroke-opacity 0.45s ease, stroke-width 0.45s ease" }}
                      className={isActive && phase === "flow" ? "context-path-flow" : undefined}
                    />
                  );
                })}

                {!reduceMotion && activePath && phase === "flow" ? (
                  <g key={packetKey} filter="url(#constellation-packet-glow)">
                    <circle r="5" fill={activeTheme.accent} opacity="0.95">
                      <animateMotion
                        dur={`${FLOW_MS}ms`}
                        path={activePath}
                        fill="freeze"
                        calcMode="spline"
                        keySplines="0.4 0 0.2 1"
                        keyTimes="0;1"
                      />
                    </circle>
                    <circle r="2" fill="#fff" opacity="0.9">
                      <animateMotion
                        dur={`${FLOW_MS}ms`}
                        path={activePath}
                        fill="freeze"
                        calcMode="spline"
                        keySplines="0.4 0 0.2 1"
                        keyTimes="0;1"
                      />
                    </circle>
                  </g>
                ) : null}
              </svg>

              {orbitNodes.map((node, i) => (
                <OrbitPill
                  key={`${scenario.id}-${node.id}`}
                  node={node}
                  staggerIndex={i}
                  compact={compact}
                  active={
                    !reduceMotion &&
                    activeNode?.id === node.id &&
                    (phase === "pulse" || phase === "flow" || phase === "land")
                  }
                  landed={chips.some((c) => c.id === node.id)}
                  pulsing={!reduceMotion && activeNode?.id === node.id && phase === "pulse"}
                />
              ))}

              <div
                className="absolute z-20"
                style={{
                  left: FILE_HUB.x - HUB_VISUAL.width / 2,
                  top: FILE_HUB.y - HUB_VISUAL.height / 2,
                  width: HUB_VISUAL.width
                }}
              >
                <div
                  className={`context-hub-card relative flex flex-col rounded-xl border bg-white px-3.5 py-3 shadow-sm transition-[border-color,box-shadow] duration-500 ${
                    chips.length > 0
                      ? "border-[#79C0FF]/55 shadow-[0_0_28px_rgba(121,192,255,0.16)]"
                      : "border-[#79C0FF]/30"
                  }`}
                  style={{
                    borderLeftWidth: 3,
                    borderLeftColor: "#79C0FF",
                    height: HUB_VISUAL.height
                  }}
                >
                  <div className="pointer-events-none absolute -inset-1 rounded-xl bg-[#79C0FF]/[0.06] blur-md" aria-hidden />
                  <div className="relative flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold text-gray-900">
                        {scenario.file.name}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-coop-muted">
                        {scenario.file.path}
                        {scenario.file.symbol ? ` · ${scenario.file.symbol}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                      {scenario.file.language}
                    </span>
                  </div>

                  <div className="relative mt-2.5 flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-hidden">
                    {chips.length === 0 ? (
                      <span className="font-mono text-[10px] text-gray-400 transition-opacity duration-300">
                        {reduceMotion ? `${scenario.sourceCount} sources linked` : "pulling context…"}
                      </span>
                    ) : (
                      chips.map((chip) => (
                        <span
                          key={chip.id}
                          className="context-chip-in inline-flex max-w-full items-center gap-1 rounded-sm border border-coop-border bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-700"
                        >
                          <OrbitIcon kind={chip.kind} className="h-3 w-3 shrink-0" />
                          <span className="truncate">{chip.label}</span>
                        </span>
                      ))
                    )}
                  </div>

                  <p className="relative mt-auto pt-1 font-mono text-[10px] text-[#3D8BDB]">
                    {chips.length}/{orbitNodes.length} sources · {scenario.feature}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="relative z-10 shrink-0 border-t border-coop-border/60 bg-gray-50/90 px-2 py-1.5 text-center font-mono text-[9px] text-gray-400 sm:text-[10px]">
        {reduceMotion
          ? "Motion reduced. Full stack context shown"
          : "Stack → Coop → grounded answers"}
      </p>
    </div>
  );
}

function OrbitPill({
  node,
  staggerIndex,
  compact,
  active,
  landed,
  pulsing
}: {
  node: LaidOutOrbitNode;
  staggerIndex: number;
  compact: boolean;
  active: boolean;
  landed: boolean;
  pulsing: boolean;
}) {
  const theme = ORBIT_THEME[node.kind] ?? ORBIT_THEME.graph;

  return (
    <div
      className="absolute z-10"
      style={{
        left: node.x,
        top: node.y,
        transform: "translate(-50%, -50%)",
        zIndex: active ? 30 : 10 + staggerIndex
      }}
    >
      <div
        className={`flex items-center gap-2 rounded-full border bg-white px-2.5 py-1.5 shadow-sm transition-[opacity,box-shadow,border-color,transform] duration-500 ease-out ${
          pulsing ? "context-orbit-pill--pulse" : ""
        } ${
          active
            ? "border-gray-900/15 opacity-100"
            : landed
              ? "border-coop-border opacity-90"
              : "border-coop-border/80 opacity-50"
        }`}
        style={{
          boxShadow: active ? `0 0 0 4px ${theme.accent}18` : undefined
        }}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full transition-colors duration-500 ${
            compact ? "h-7 w-7" : "h-6 w-6"
          }`}
          style={{ backgroundColor: `${theme.accent}18`, color: theme.accent }}
        >
          <OrbitIcon kind={node.kind} className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </span>
        <div className={`min-w-0 ${compact ? "max-w-[8.5rem]" : "max-w-[7.25rem]"}`}>
          <p
            className={`truncate font-mono font-medium leading-tight text-gray-900 ${
              compact ? "text-[11px]" : "text-[10px]"
            }`}
          >
            {node.label}
          </p>
          <p
            className={`truncate leading-tight text-coop-muted ${
              compact ? "text-[10px]" : "text-[9px]"
            }`}
          >
            {node.sublabel}
          </p>
        </div>
      </div>
    </div>
  );
}

function OrbitIcon({ kind, className }: { kind: OrbitNodeKind; className?: string }) {
  const theme = ORBIT_THEME[kind] ?? ORBIT_THEME.graph;
  const Icon = ORBIT_ICONS[kind];

  if (kind === "github" || kind === "slack" || kind === "jira" || kind === "notion" || kind === "docs") {
    const BrandIcon = Icon as (props: BrandIconProps) => ReactNode;
    return <BrandIcon className={className} />;
  }

  const Lucide = Icon as LucideIcon;
  return <Lucide className={className} style={{ color: theme.accent }} aria-hidden />;
}
