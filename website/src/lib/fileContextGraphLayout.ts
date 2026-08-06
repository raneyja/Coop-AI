import type { FileContextScenario } from "./fileContextScenarios";

export const VIEW_W = 920;
export const VIEW_H = 580;

export const FILE_HUB = {
  x: VIEW_W / 2,
  y: VIEW_H / 2 - 8
};

export const FILE_CARD = { width: 228, height: 80 };
export const ORBIT_CARD = { height: 54, minWidth: 148 };

const LAYOUT_SAFETY = 1.08;
const COLLISION_CLEARANCE = 24;

export const ORBIT_THEME: Record<
  string,
  { accent: string; iconColor?: string }
> = {
  github: { accent: "#58A6FF" },
  slack: { accent: "#BC8CFF" },
  jira: { accent: "#58A6FF" },
  commits: { accent: "#79C0FF" },
  docs: { accent: "#3FB950" },
  graph: { accent: "#79C0FF" },
  gap: { accent: "#E3B341" },
  notion: { accent: "#E6EDF3" },
  codeowners: { accent: "#BC8CFF" },
  services: { accent: "#F778BA" }
};

export type LaidOutOrbitNode = FileContextScenario["orbitNodes"][number] & {
  cardWidth: number;
  x: number;
  y: number;
};

export function displayOrbitWidth(label: string, sublabel: string): number {
  const charWidthLabel = 7.2;
  const charWidthSub = 6.1;
  const chrome = 52;
  const labelW = chrome + label.length * charWidthLabel;
  const subW = chrome + sublabel.length * charWidthSub;
  return Math.max(ORBIT_CARD.minWidth, Math.ceil(Math.max(labelW, subW) * LAYOUT_SAFETY));
}

export function polarToCartesian(
  cx: number,
  cy: number,
  angleDeg: number,
  radius: number
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad)
  };
}

export function intersectRectToward(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  targetX: number,
  targetY: number
): { x: number; y: number } {
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { x: cx, y: cy };
  }
  const scale = Math.min(halfW / Math.abs(dx), halfH / Math.abs(dy));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function bezierPathBetween(sx: number, sy: number, ex: number, ey: number): string {
  const dx = ex - sx;
  const dy = ey - sy;
  const c1x = sx + dx * 0.28;
  const c1y = sy + dy * 0.32;
  const c2x = sx + dx * 0.62;
  const c2y = sy + dy * 0.88;
  return `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
}

export function orbitConnectionPath(node: LaidOutOrbitNode): string {
  const halfW = (node.cardWidth / 2) * LAYOUT_SAFETY;
  const halfH = (ORBIT_CARD.height / 2) * LAYOUT_SAFETY;
  const start = intersectRectToward(node.x, node.y, halfW, halfH, FILE_HUB.x, FILE_HUB.y);
  // Match the visual hub card (taller than FILE_CARD.height — chips stack inside).
  const fileHalfW = HUB_VISUAL.width / 2;
  const fileHalfH = HUB_VISUAL.height / 2;
  const end = intersectRectToward(FILE_HUB.x, FILE_HUB.y, fileHalfW, fileHalfH, node.x, node.y);
  return bezierPathBetween(start.x, start.y, end.x, end.y);
}

/** Visual hub footprint used in ContextConstellation (includes chip stack). */
export const HUB_VISUAL = {
  width: FILE_CARD.width + 28,
  height: 132
};

function rayRectExtent(halfW: number, halfH: number, ux: number, uy: number): number {
  const tx = Math.abs(ux) < 1e-6 ? Number.POSITIVE_INFINITY : halfW / Math.abs(ux);
  const ty = Math.abs(uy) < 1e-6 ? Number.POSITIVE_INFINITY : halfH / Math.abs(uy);
  return Math.min(tx, ty);
}

/** Minimum polar radius so a pill does not overlap the hub card. */
export function minOrbitRadiusClearingHub(angleDeg: number, cardWidth: number): number {
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const hubExtent = rayRectExtent(HUB_VISUAL.width / 2, HUB_VISUAL.height / 2, ux, uy);
  const pillExtent = rayRectExtent(cardWidth / 2, ORBIT_CARD.height / 2, ux, uy);
  return hubExtent + pillExtent + COLLISION_CLEARANCE;
}

export function layoutOrbitNodes(
  scenario: FileContextScenario,
  radiusScale = 1
): LaidOutOrbitNode[] {
  return scenario.orbitNodes.map((node) => {
    const cardWidth = displayOrbitWidth(node.label, node.sublabel);
    const scaled = node.radius * radiusScale;
    const cleared = Math.max(scaled, minOrbitRadiusClearingHub(node.angle, cardWidth));
    const { x, y } = polarToCartesian(FILE_HUB.x, FILE_HUB.y, node.angle, cleared);
    return {
      ...node,
      radius: cleared,
      cardWidth,
      x,
      y
    };
  });
}

/** Axis-aligned bounds of hub + orbit pills — used to zoom mobile into content, not empty canvas. */
export function constellationContentBounds(nodes: LaidOutOrbitNode[]): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const pillHalfH = ORBIT_CARD.height / 2 + 4;
  const hubHalfW = HUB_VISUAL.width / 2;
  const hubHalfH = HUB_VISUAL.height / 2;
  let minX = FILE_HUB.x - hubHalfW;
  let maxX = FILE_HUB.x + hubHalfW;
  let minY = FILE_HUB.y - hubHalfH;
  let maxY = FILE_HUB.y + hubHalfH;

  for (const node of nodes) {
    const halfW = node.cardWidth / 2 + 4;
    minX = Math.min(minX, node.x - halfW);
    maxX = Math.max(maxX, node.x + halfW);
    minY = Math.min(minY, node.y - pillHalfH);
    maxY = Math.max(maxY, node.y + pillHalfH);
  }

  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(VIEW_W, maxX + pad);
  maxY = Math.min(VIEW_H, maxY + pad);

  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

export function widthPct(cardWidth: number): number {
  return (cardWidth / VIEW_W) * 100;
}

export function heightPct(height: number): number {
  return (height / VIEW_H) * 100;
}
