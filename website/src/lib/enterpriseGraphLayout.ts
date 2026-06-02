export type GraphCategory = "repos" | "code" | "collab" | "ai" | "editor";

export type GraphNodeDef = {
  id: string;
  label: string;
  categoryLabel: string;
  category: GraphCategory;
  connectionWeight: "active" | "passive";
  icon:
    | "github"
    | "gitlab"
    | "bitbucket"
    | "slack"
    | "jira"
    | "sparkles"
    | "vscode"
    | "fileCode"
    | "folder"
    | "gitCommit";
};

export type LaidOutNode = GraphNodeDef & {
  angle: number;
  radius: number;
  cardWidth: number;
};

export const VIEW_W = 1000;
export const VIEW_H = 760;

export const CANVAS_PAD = { top: 44, right: 40, bottom: 56, left: 40 };

export const INNER_BOUNDS = {
  left: CANVAS_PAD.left,
  right: VIEW_W - CANVAS_PAD.right,
  top: CANVAS_PAD.top,
  bottom: VIEW_H - CANVAS_PAD.bottom
};

export const NODE_CARD = { height: 52, minWidth: 160 };

export const HUB_CARD = { width: 108, height: 40 };

export const GRAPH_HUB = {
  x: VIEW_W / 2,
  y: VIEW_H * 0.5
};

export const CATEGORY_THEME: Record<
  GraphCategory,
  { accent: string; zone: string; label: string }
> = {
  repos: { accent: "#58A6FF", zone: "rgba(88, 166, 255, 0.06)", label: "Repositories" },
  code: { accent: "#79C0FF", zone: "rgba(121, 192, 255, 0.05)", label: "Code graph" },
  collab: { accent: "#BC8CFF", zone: "rgba(188, 140, 255, 0.06)", label: "Team context" },
  ai: { accent: "#3FB950", zone: "rgba(63, 185, 80, 0.06)", label: "AI & inference" },
  editor: { accent: "#1F6FEB", zone: "rgba(31, 111, 235, 0.05)", label: "Developer surface" }
};

export const GRAPH_NODES: GraphNodeDef[] = [
  { id: "bitbucket", label: "Bitbucket", categoryLabel: "Remote indexing", category: "repos", connectionWeight: "active", icon: "bitbucket" },
  { id: "jira", label: "Jira", categoryLabel: "Tickets & incidents", category: "collab", connectionWeight: "passive", icon: "jira" },
  { id: "github", label: "GitHub", categoryLabel: "Webhooks & PR history", category: "repos", connectionWeight: "active", icon: "github" },
  { id: "gitlab", label: "GitLab", categoryLabel: "Repos & pipelines", category: "repos", connectionWeight: "active", icon: "gitlab" },
  { id: "commit", label: "Recent commits", categoryLabel: "Decision signals", category: "code", connectionWeight: "active", icon: "gitCommit" },
  { id: "slack", label: "Slack", categoryLabel: "Threads & decisions", category: "collab", connectionWeight: "passive", icon: "slack" },
  { id: "auth", label: "auth_middleware.go", categoryLabel: "Ownership & blame", category: "code", connectionWeight: "active", icon: "fileCode" },
  { id: "folder", label: "components/", categoryLabel: "92 files · symbol graph", category: "code", connectionWeight: "active", icon: "folder" },
  { id: "llm", label: "LLM providers", categoryLabel: "BYOK · zero-retention", category: "ai", connectionWeight: "passive", icon: "sparkles" },
  { id: "token", label: "token_validator.ts", categoryLabel: "Cross-repo references", category: "code", connectionWeight: "active", icon: "fileCode" },
  { id: "vscode", label: "VS Code", categoryLabel: "Sidebar & quick actions", category: "editor", connectionWeight: "active", icon: "vscode" }
];

/** Hand-tuned positions — zero box overlap on the upper arc (verified in layout math). */
const TUNED_POSITIONS: Array<{ id: GraphNodeDef["id"]; angle: number; radius: number }> = [
  { id: "bitbucket", angle: -177.9, radius: 197 },
  { id: "github", angle: -154.4, radius: 228 },
  { id: "jira", angle: -122.7, radius: 220 },
  { id: "gitlab", angle: -116.4, radius: 296 },
  { id: "commit", angle: -71.1, radius: 296 },
  { id: "slack", angle: -40.9, radius: 296 },
  { id: "auth", angle: -26.6, radius: 243 },
  { id: "folder", angle: -7.7, radius: 217 },
  { id: "llm", angle: 22.5, radius: 203 },
  { id: "token", angle: 37.8, radius: 278 },
  { id: "vscode", angle: 74.5, radius: 263 }
];

const COLLISION_CLEARANCE = 22;
const LAYOUT_SAFETY = 1.1;

export function displayCardWidth(label: string, categoryLabel: string): number {
  const charWidthLabel = 7.4;
  const charWidthCategory = 6.3;
  const chrome = 54;
  const labelW = chrome + label.length * charWidthLabel;
  const categoryW = chrome + categoryLabel.length * charWidthCategory;
  return Math.max(NODE_CARD.minWidth, Math.ceil(Math.max(labelW, categoryW) * LAYOUT_SAFETY));
}

export function angularHalfWidthDeg(radius: number, cardWidth: number): number {
  const halfChord = (cardWidth / 2) * LAYOUT_SAFETY + COLLISION_CLEARANCE / 2;
  return (Math.atan(halfChord / Math.max(radius, 80)) * 180) / Math.PI;
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

export function nodeCenter(node: LaidOutNode): { x: number; y: number } {
  return polarToCartesian(GRAPH_HUB.x, GRAPH_HUB.y, node.angle, node.radius);
}

export function bezierPathBetween(sx: number, sy: number, ex: number, ey: number): string {
  const dx = ex - sx;
  const dy = ey - sy;
  const c1x = sx + dx * 0.22;
  const c1y = sy + dy * 0.28;
  const c2x = sx + dx * 0.58;
  const c2y = sy + dy * 0.88;
  return `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
}

export function connectionPath(node: LaidOutNode): string {
  const center = nodeCenter(node);
  const halfW = (node.cardWidth / 2) * LAYOUT_SAFETY;
  const halfH = (NODE_CARD.height / 2) * LAYOUT_SAFETY;
  const start = intersectRectToward(
    center.x,
    center.y,
    halfW,
    halfH,
    GRAPH_HUB.x,
    GRAPH_HUB.y
  );
  const hubHalfW = HUB_CARD.width / 2;
  const hubHalfH = HUB_CARD.height / 2;
  const end = intersectRectToward(
    GRAPH_HUB.x,
    GRAPH_HUB.y,
    hubHalfW,
    hubHalfH,
    center.x,
    center.y
  );
  return bezierPathBetween(start.x, start.y, end.x, end.y);
}

export function widthPct(cardWidth: number): number {
  return (cardWidth / VIEW_W) * 100;
}

export function heightPct(height: number): number {
  return (height / VIEW_H) * 100;
}

export function computeGraphLayout(): LaidOutNode[] {
  return GRAPH_NODES.map((def) => {
    const tuned = TUNED_POSITIONS.find((p) => p.id === def.id);
    if (!tuned) {
      throw new Error(`Missing tuned layout position for node: ${def.id}`);
    }
    return {
      ...def,
      angle: tuned.angle,
      radius: tuned.radius,
      cardWidth: displayCardWidth(def.label, def.categoryLabel)
    };
  }).sort((a, b) => a.angle - b.angle);
}

export function categoryArcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number
): string {
  const start = polarToCartesian(cx, cy, startDeg, outerR);
  const end = polarToCartesian(cx, cy, endDeg, outerR);
  const startInner = polarToCartesian(cx, cy, endDeg, innerR);
  const endInner = polarToCartesian(cx, cy, startDeg, innerR);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${start.x} ${start.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${end.x} ${end.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${endInner.x} ${endInner.y}`,
    "Z"
  ].join(" ");
}

export function categoryAngleRanges(
  nodes: LaidOutNode[]
): Array<{ category: GraphCategory; start: number; end: number }> {
  const ranges: Array<{ category: GraphCategory; start: number; end: number }> = [];
  let group: LaidOutNode[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const halfFirst = angularHalfWidthDeg(group[0].radius, group[0].cardWidth);
    const halfLast = angularHalfWidthDeg(
      group[group.length - 1].radius,
      group[group.length - 1].cardWidth
    );
    ranges.push({
      category: group[0].category,
      start: group[0].angle - halfFirst - 6,
      end: group[group.length - 1].angle + halfLast + 6
    });
    group = [];
  };

  for (const node of nodes) {
    if (group.length > 0 && group[0].category !== node.category) {
      flush();
    }
    group.push(node);
  }
  flush();

  return ranges;
}
