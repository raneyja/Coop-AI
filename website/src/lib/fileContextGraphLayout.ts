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
const COLLISION_CLEARANCE = 18;

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
  const fileHalfW = FILE_CARD.width / 2;
  const fileHalfH = FILE_CARD.height / 2;
  const end = intersectRectToward(FILE_HUB.x, FILE_HUB.y, fileHalfW, fileHalfH, node.x, node.y);
  return bezierPathBetween(start.x, start.y, end.x, end.y);
}

export function layoutOrbitNodes(scenario: FileContextScenario): LaidOutOrbitNode[] {
  return scenario.orbitNodes.map((node) => {
    const { x, y } = polarToCartesian(FILE_HUB.x, FILE_HUB.y, node.angle, node.radius);
    return {
      ...node,
      cardWidth: displayOrbitWidth(node.label, node.sublabel),
      x,
      y
    };
  });
}

export function widthPct(cardWidth: number): number {
  return (cardWidth / VIEW_W) * 100;
}

export function heightPct(height: number): number {
  return (height / VIEW_H) * 100;
}
