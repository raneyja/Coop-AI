/**
 * Compact agent tool transcripts for the final streamChat turn.
 * Planning still sees full last-tool JSON; only the writer history is shrunk.
 * Unauthorized/401 write sites keep a window around the write, not a path-only
 * head clip — the writer must see the shape to name a ripple.
 */

import { excerptUnauthorizedWrite } from "../api/agent/searchQuery";

const MAX_SUMMARY_CHARS = 1200;
const MAX_FILE_BODY_CHARS = 400;
const MAX_HIT_SNIPPET_CHARS = 200;
const MAX_FILES = 6;
const MAX_HITS = 8;

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max).trimEnd()}…`;
}

export function summarizeAgentToolResultForHistory(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return content;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return clip(trimmed, MAX_SUMMARY_CHARS);
    }
    return JSON.stringify(compactToolJson(parsed as Record<string, unknown>));
  } catch {
    return clip(trimmed, MAX_SUMMARY_CHARS);
  }
}

function compactToolJson(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof obj.error === "string") {
    out.error = clip(obj.error, 240);
  }
  if (typeof obj.path === "string") {
    out.path = obj.path;
  }
  if (typeof obj.skipNote === "string") {
    out.skipNote = clip(obj.skipNote, 240);
  }
  if (Array.isArray(obj.files)) {
    out.files = obj.files.slice(0, MAX_FILES).map((file) => compactFile(file));
  }
  if (Array.isArray(obj.hits)) {
    out.hits = obj.hits.slice(0, MAX_HITS).map((hit) => compactHit(hit));
  }
  if (Array.isArray(obj.preferredHits)) {
    out.preferredHits = obj.preferredHits.slice(0, MAX_HITS).map((hit) => compactHit(hit));
  }
  if (Array.isArray(obj.symbols)) {
    out.symbols = obj.symbols.slice(0, MAX_HITS).map((symbol) => compactHit(symbol));
  }
  if (Object.keys(out).length === 0) {
    return { summary: clip(JSON.stringify(obj), MAX_SUMMARY_CHARS) };
  }
  return out;
}

function compactFile(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { value: clip(String(value), 80) };
  }
  const file = value as Record<string, unknown>;
  const path = typeof file.path === "string" ? file.path : undefined;
  const content =
    typeof file.content === "string" ? clipFileBody(file.content, MAX_FILE_BODY_CHARS) : undefined;
  return {
    ...(path ? { path } : {}),
    ...(content ? { content } : {}),
    ...(typeof file.startLine === "number" ? { startLine: file.startLine } : {}),
    ...(typeof file.endLine === "number" ? { endLine: file.endLine } : {})
  };
}

function clipFileBody(content: string, max: number): string {
  if (content.length <= max) {
    return content;
  }
  const excerpt = excerptUnauthorizedWrite(content, max);
  if (excerpt) {
    return excerpt;
  }
  return clip(content, max);
}

function compactHit(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { value: clip(String(value), 80) };
  }
  const hit = value as Record<string, unknown>;
  const fileName =
    typeof hit.fileName === "string"
      ? hit.fileName
      : typeof hit.path === "string"
        ? hit.path
        : undefined;
  const snippet =
    typeof hit.content === "string"
      ? clip(hit.content, MAX_HIT_SNIPPET_CHARS)
      : typeof hit.snippet === "string"
        ? clip(hit.snippet, MAX_HIT_SNIPPET_CHARS)
        : undefined;
  return {
    ...(fileName ? { fileName } : {}),
    ...(snippet ? { content: snippet } : {}),
    ...(typeof hit.line === "number" ? { line: hit.line } : {})
  };
}
