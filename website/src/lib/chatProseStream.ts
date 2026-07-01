/**
 * Char-by-char stream plan for `StoryChatProse` (legacy `FileContextStoryDemo` path).
 * Production homepage responses live in `HeroDemoArtifact.tsx`.
 */
import type { ChatInlineNode, ChatListItem, ChatProseBlock } from "./chatProseTypes";

export type StreamSnapshot = {
  blocks: ChatProseBlock[];
};

export type ChatProseStreamTiming = {
  answerCharMs: number;
  answerAtomicPauseMs: number;
  answerFirstMs: number;
};

export type ChatProseStreamPlan = {
  snapshots: StreamSnapshot[];
  delays: number[];
  totalUnits: number;
};

function inlineCharLength(nodes: ChatInlineNode[]): number {
  let n = 0;
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "strong":
        n += node.text.length;
        break;
      case "inline-code":
        n += node.code.length;
        break;
      case "file-link":
      case "external-link":
        n += node.label.length;
        break;
    }
  }
  return n;
}

function truncateInlineNodes(nodes: ChatInlineNode[], maxChars: number): ChatInlineNode[] {
  const result: ChatInlineNode[] = [];
  let remaining = maxChars;

  for (const node of nodes) {
    if (remaining <= 0) break;

    switch (node.type) {
      case "text":
      case "strong": {
        const take = Math.min(remaining, node.text.length);
        if (take > 0) {
          result.push({ ...node, text: node.text.slice(0, take) });
          remaining -= take;
        }
        break;
      }
      case "inline-code": {
        const take = Math.min(remaining, node.code.length);
        if (take > 0) {
          result.push({ ...node, code: node.code.slice(0, take) });
          remaining -= take;
        }
        break;
      }
      case "file-link":
      case "external-link": {
        const len = node.label.length;
        if (remaining >= len) {
          result.push(node);
          remaining -= len;
        }
        break;
      }
    }
  }

  return result;
}

function truncateListItems(items: ChatListItem[], maxChars: number): ChatListItem[] {
  const result: ChatListItem[] = [];
  let remaining = maxChars;

  for (const item of items) {
    if (remaining <= 0) break;
    const itemLen = inlineCharLength(item.content);
    const take = Math.min(remaining, itemLen);
    if (take > 0) {
      result.push({ ...item, content: truncateInlineNodes(item.content, take) });
      remaining -= take;
    }
  }

  return result;
}

function buildSnapshots(blocks: ChatProseBlock[]): StreamSnapshot[] {
  const snapshots: StreamSnapshot[] = [{ blocks: [] }];
  let completeBlocks: ChatProseBlock[] = [];

  for (const block of blocks) {
    if (block.type === "code-fence" || block.type === "code-citation") {
      completeBlocks = [...completeBlocks, block];
      snapshots.push({ blocks: [...completeBlocks] });
      continue;
    }

    if (block.type === "section-heading") {
      for (let c = 1; c <= block.text.length; c++) {
        snapshots.push({
          blocks: [...completeBlocks, { type: "section-heading", text: block.text.slice(0, c) }]
        });
      }
      completeBlocks = [...completeBlocks, block];
      continue;
    }

    if (block.type === "paragraph") {
      const total = inlineCharLength(block.content);
      for (let c = 1; c <= total; c++) {
        snapshots.push({
          blocks: [
            ...completeBlocks,
            { type: "paragraph", content: truncateInlineNodes(block.content, c) }
          ]
        });
      }
      completeBlocks = [...completeBlocks, block];
      continue;
    }

    if (block.type === "list") {
      const total = block.items.reduce((sum, item) => sum + inlineCharLength(item.content), 0);
      for (let c = 1; c <= total; c++) {
        snapshots.push({
          blocks: [
            ...completeBlocks,
            { type: "list", items: truncateListItems(block.items, c) }
          ]
        });
      }
      completeBlocks = [...completeBlocks, block];
    }
  }

  return snapshots;
}

function extractAllText(blocks: ChatProseBlock[]): string {
  let text = "";

  for (const block of blocks) {
    switch (block.type) {
      case "section-heading":
        text += block.text;
        break;
      case "paragraph":
        text += inlineNodesText(block.content);
        break;
      case "list":
        for (const item of block.items) {
          text += inlineNodesText(item.content);
        }
        break;
      case "code-fence":
        text += block.code;
        break;
      case "code-citation":
        text += block.code;
        break;
    }
  }

  return text;
}

function inlineNodesText(nodes: ChatInlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "strong":
          return node.text;
        case "inline-code":
          return node.code;
        case "file-link":
        case "external-link":
          return node.label;
        default:
          return "";
      }
    })
    .join("");
}

function isAtomicStep(prev: StreamSnapshot, next: StreamSnapshot): boolean {
  if (next.blocks.length > prev.blocks.length) {
    const newBlock = next.blocks[next.blocks.length - 1];
    return newBlock.type === "code-fence" || newBlock.type === "code-citation";
  }

  const prevText = extractAllText(prev.blocks);
  const nextText = extractAllText(next.blocks);
  return nextText.length - prevText.length > 1;
}

function getNewChar(prev: StreamSnapshot, next: StreamSnapshot): string | null {
  const prevText = extractAllText(prev.blocks);
  const nextText = extractAllText(next.blocks);
  if (nextText.length <= prevText.length) return null;
  return nextText[nextText.length - 1] ?? null;
}

export function buildChatProseStreamPlan(
  blocks: ChatProseBlock[],
  timing: ChatProseStreamTiming
): ChatProseStreamPlan {
  const snapshots = buildSnapshots(blocks);
  const totalUnits = Math.max(0, snapshots.length - 1);
  const delays: number[] = [];

  for (let i = 0; i < totalUnits; i++) {
    if (i === 0) {
      delays.push(timing.answerFirstMs);
      continue;
    }

    const prev = snapshots[i]!;
    const next = snapshots[i + 1]!;

    if (isAtomicStep(prev, next)) {
      delays.push(timing.answerAtomicPauseMs);
      continue;
    }

    const ch = getNewChar(prev, next);
    let delay = timing.answerCharMs;
    if (ch && /[.!?]/.test(ch)) delay += 70;
    delays.push(delay);
  }

  return { snapshots, delays, totalUnits };
}

export function getStreamSnapshot(plan: ChatProseStreamPlan, streamIndex: number): StreamSnapshot {
  const clamped = Math.max(0, Math.min(streamIndex, plan.totalUnits));
  return plan.snapshots[clamped] ?? { blocks: [] };
}
