/**
 * Existing-capability grounding for ticket-style “add feature X” asks.
 *
 * When a starter file is open, search that file/module for the asked symbol
 * before advising greenfield work. If X already exists → say **extend**;
 * otherwise → allow **add-new**. Never invent APIs absent from evidence.
 */

export type CapabilityVerdict = "already-exists" | "add-new";

export type CapabilitySymbolHit = {
  line: number;
  kind: "string-key" | "identifier" | "comment" | "inverse-pair";
  snippet: string;
  /** Related peer when inverse maps are present (e.g. blocking ↔ blocked_by). */
  pairedWith?: string;
};

export type CapabilityExtendHint = {
  line?: number;
  summary: string;
  snippet?: string;
};

export type ExistingCapabilityEvidence = {
  filePath: string;
  /** Normalized capability token (e.g. blocked_by). */
  capability: string;
  /** Human label from the ask (e.g. "blocked by"). */
  capabilityLabel: string;
  verdict: CapabilityVerdict;
  hits: CapabilitySymbolHit[];
  /** Where to extend when the capability already exists — never invent symbols. */
  extendPoints: CapabilityExtendHint[];
  /** Sibling keys / related symbols found in the same maps. */
  relatedSymbols: string[];
  gaps: string[];
};

const FEATURE_ADD_SIGNAL_RE =
  /\b(?:add(?:ing|ed)?|implement(?:ing|ed)?|introduc(?:e|ing|ed)|creat(?:e|ing|ed)|support(?:ing)?|enable(?:ing)?|ship(?:ping)?)\b/i;

const FEATURE_KIND_RE =
  /\b(?:link\s+type|relation(?:ship)?\s+type|relation(?:ship)?s?|type|feature|capability|field|enum|mode|option|handler|endpoint|api|mapping|mapper)\b/i;

const TICKET_FRAMING_RE =
  /\b(?:we(?:'re| are)|i(?:'m| am)|let'?s|need to|want to|should|planning to|ticket|story|task|pr|mr|we're adding|adding a|adding an)\b/i;

/** Detect ticket-style “add / implement X type|link|relation…” asks. */
export function isFeatureAddAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 10) {
    return false;
  }
  if (!FEATURE_ADD_SIGNAL_RE.test(text)) {
    return false;
  }
  if (!FEATURE_KIND_RE.test(text) && !/\bnew\b/i.test(text)) {
    return false;
  }
  // Prefer framed product/ticket asks; still allow plain “add blocked_by link type”.
  if (TICKET_FRAMING_RE.test(text) || FEATURE_KIND_RE.test(text)) {
    return parseAskedCapability(text) !== undefined;
  }
  return false;
}

/**
 * Extract the capability token the user wants to add.
 * Examples: "blocked by link type" → blocked_by; "blocked_by relation" → blocked_by.
 */
export function parseAskedCapability(ask: string): { token: string; label: string } | undefined {
  const text = ask.trim();
  if (!text) {
    return undefined;
  }

  // Prefer "X link type" / "X relation" phrases before loose identifier scans
  // (avoids grabbing filler words like "what" from the rest of the sentence).
  // Prefer "adding a blocked by link type" — anchor after the add/implement verb
  // so we do not swallow the verb into the capability label.
  const phraseBeforeKind = text.match(
    /\b(?:add(?:ing|ed)?|implement(?:ing|ed)?|introduc(?:e|ing)|creat(?:e|ing)|support(?:ing)?)\s+(?:a|an|the|new)?\s*([a-z][a-z0-9_]*(?:[\s_-]+[a-z][a-z0-9_]*){0,3})\s+(?:link\s+type|relation(?:ship)?\s+type|relation(?:ship)?s?|feature|field|enum|mapping)\b/i
  );
  if (phraseBeforeKind?.[1]) {
    const label = phraseBeforeKind[1].trim();
    const cleaned = label.replace(/^(?:new|support(?:ing)?|for)\s+/i, "").trim();
    if (cleaned && !/^(?:link|relation|type|feature)$/i.test(cleaned)) {
      return { token: normalizeCapabilityToken(cleaned), label: cleaned };
    }
  }

  // Explicit snake_case near add/implement (case-insensitive).
  const snakeNearAdd = text.match(
    /\b(?:add(?:ing|ed)?|implement(?:ing|ed)?|introduc(?:e|ing)|creat(?:e|ing)|support(?:ing)?)\b[^.\n]{0,48}\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/i
  );
  if (snakeNearAdd?.[1]) {
    const raw = snakeNearAdd[1];
    return { token: normalizeCapabilityToken(raw), label: raw };
  }

  // camelCase near add/implement — must stay case-sensitive so /i does not
  // turn [A-Z] into “any letter” and match filler words.
  const addVerb = text.match(
    /\b(?:add(?:ing|ed)?|implement(?:ing|ed)?|introduc(?:e|ing)|creat(?:e|ing)|support(?:ing)?)\b/i
  );
  if (addVerb && addVerb.index !== undefined) {
    const window = text.slice(addVerb.index, addVerb.index + addVerb[0].length + 48);
    const camel = window.match(/\b([a-z]+[A-Z][a-zA-Z0-9]*)\b/);
    if (camel?.[1]) {
      return { token: normalizeCapabilityToken(camel[1]), label: camel[1] };
    }
  }

  // Trailing "add blocked_by" without kind word.
  const trailingIdent = text.match(
    /\b(?:add(?:ing)?|implement(?:ing)?)\s+(?:a|an|the|new)?\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/i
  );
  if (trailingIdent?.[1]) {
    return { token: normalizeCapabilityToken(trailingIdent[1]), label: trailingIdent[1] };
  }

  // "X type" as a last resort (single token before bare "type").
  const bareType = text.match(
    /\b(?:a|an|the|new)?\s*([a-z][a-z0-9]+(?:_[a-z0-9]+)+)\s+type\b/i
  );
  if (bareType?.[1]) {
    return { token: normalizeCapabilityToken(bareType[1]), label: bareType[1] };
  }

  return undefined;
}

export function normalizeCapabilityToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  // camelCase → snake_case
  if (/[a-z][A-Z]/.test(trimmed) && !trimmed.includes("_") && !/\s/.test(trimmed)) {
    return trimmed
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/-/g, "_")
      .toLowerCase();
  }
  return trimmed
    .replace(/-/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capabilitySearchForms(token: string, label: string): string[] {
  const forms = new Set<string>();
  forms.add(token);
  forms.add(label.toLowerCase());
  forms.add(token.replace(/_/g, " "));
  forms.add(token.replace(/_/g, "-"));
  // camelCase
  const camel = token.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camel !== token) {
    forms.add(camel);
  }
  return [...forms].filter(Boolean);
}

/**
 * Scan open-file evidence for the asked capability and related extend points.
 */
export function extractExistingCapabilityEvidence(options: {
  filePath: string;
  fileContent: string;
  ask: string;
}): ExistingCapabilityEvidence | undefined {
  const parsed = parseAskedCapability(options.ask);
  if (!parsed) {
    return undefined;
  }

  const lines = options.fileContent.split(/\r?\n/);
  const forms = capabilitySearchForms(parsed.token, parsed.label);
  const hits: CapabilitySymbolHit[] = [];
  const related = new Set<string>();
  const extendPoints: CapabilityExtendHint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    const lower = line.toLowerCase();

    for (const form of forms) {
      const formLower = form.toLowerCase();
      if (!formLower || !lower.includes(formLower)) {
        continue;
      }

      // String dict key: "blocked_by": ...
      const stringKey = new RegExp(`["']${escapeRegExp(form)}["']\\s*:`, "i");
      if (stringKey.test(line)) {
        const pair = extractInversePair(line, form);
        hits.push({
          line: lineNo,
          kind: pair ? "inverse-pair" : "string-key",
          snippet: line.trim().slice(0, 160),
          pairedWith: pair
        });
        if (pair) {
          related.add(normalizeCapabilityToken(pair));
        }
        continue;
      }

      // Identifier use (not only inside longer words when form has underscore).
      const identRe =
        form.includes("_") || form.includes("-")
          ? new RegExp(`\\b${escapeRegExp(form)}\\b`, "i")
          : new RegExp(`(?:^|[^a-zA-Z0-9_])${escapeRegExp(form)}(?:[^a-zA-Z0-9_]|$)`, "i");
      if (identRe.test(line)) {
        const kind: CapabilitySymbolHit["kind"] = /^\s*#|^\s*\/\/|^\s*\*/.test(line)
          ? "comment"
          : "identifier";
        hits.push({
          line: lineNo,
          kind,
          snippet: line.trim().slice(0, 160)
        });
      }
    }

    // Sibling string keys in relation-style maps (same line or nearby).
    for (const sibling of extractStringKeys(line)) {
      const norm = normalizeCapabilityToken(sibling);
      if (norm && norm !== parsed.token) {
        related.add(norm);
      }
    }
  }

  // Deduplicate hits by line+kind.
  const seenHit = new Set<string>();
  const uniqueHits = hits.filter((hit) => {
    const key = `${hit.line}:${hit.kind}:${hit.snippet}`;
    if (seenHit.has(key)) {
      return false;
    }
    seenHit.add(key);
    return true;
  });

  const exists = uniqueHits.some(
    (hit) => hit.kind === "string-key" || hit.kind === "identifier" || hit.kind === "inverse-pair"
  );

  if (exists) {
    // Inverse / bidirectional mapping is the primary extend surface in mappers.
    const inverseHits = uniqueHits.filter((h) => h.kind === "inverse-pair" || h.pairedWith);
    if (inverseHits.length > 0) {
      for (const hit of inverseHits.slice(0, 4)) {
        extendPoints.push({
          line: hit.line,
          summary: hit.pairedWith
            ? `\`${parsed.token}\` already maps with \`${hit.pairedWith}\` — do not add a duplicate relation type; extend validation / API surfaces that consume this mapper.`
            : `\`${parsed.token}\` already appears as a mapped key — extend consumers, do not re-declare the type.`,
          snippet: hit.snippet
        });
      }
    } else {
      const first = uniqueHits[0]!;
      extendPoints.push({
        line: first.line,
        summary: `\`${parsed.token}\` already exists in \`${options.filePath}\` — extend call sites / validation rather than adding a new type.`,
        snippet: first.snippet
      });
    }

    // Heuristic extend targets named in-file (ViewSet, serializer, validate…).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (
        /\b(ViewSet|Serializer|validator|validate_|get_inverse|inverse_relation|clean_|permission)\b/i.test(
          line
        )
      ) {
        const nameMatch = line.match(
          /\b([A-Z][A-Za-z0-9_]*(?:ViewSet|Serializer)|get_inverse_\w+|validate_\w+)\b/
        );
        extendPoints.push({
          line: i + 1,
          summary: nameMatch
            ? `Likely extend point in open file: \`${nameMatch[1]}\` (validation / inverse / API surface).`
            : "Open file mentions validation/ViewSet/serializer — prefer extending those consumers over adding a duplicate type.",
          snippet: line.trim().slice(0, 160)
        });
        if (extendPoints.length >= 6) {
          break;
        }
      }
    }

    // Always surface a generic consumer-extension hint when mapper-like.
    if (
      /mapper|relation|inverse/i.test(options.filePath) ||
      /mapper|relation|inverse/i.test(options.fileContent.slice(0, 2000))
    ) {
      extendPoints.push({
        summary:
          "Prefer extending ViewSet / serializer validation and API acceptance of this relation — the mapper entry already exists."
      });
    }
  }

  const gaps: string[] = [];
  if (!exists) {
    gaps.push(
      `\`${parsed.token}\` was not found in open-file evidence — add-new is allowed, but still search the module before inventing parallel types.`
    );
  } else {
    gaps.push(
      "Do not invent APIs, endpoints, or relation types absent from evidence. Cite only symbols shown in `<existing_capability_evidence>`."
    );
  }

  return {
    filePath: options.filePath,
    capability: parsed.token,
    capabilityLabel: parsed.label,
    verdict: exists ? "already-exists" : "add-new",
    hits: uniqueHits.slice(0, 24),
    extendPoints: dedupeExtendPoints(extendPoints).slice(0, 8),
    relatedSymbols: [...related].filter((s) => s !== parsed.token).slice(0, 12),
    gaps
  };
}

function extractInversePair(line: string, form: string): string | undefined {
  // "blocked_by": "blocking"  or  "blocking": "blocked_by"
  const asKey = line.match(
    new RegExp(`["']${escapeRegExp(form)}["']\\s*:\\s*["']([^"']+)["']`, "i")
  );
  if (asKey?.[1]) {
    return asKey[1];
  }
  const asValue = line.match(
    new RegExp(`["']([^"']+)["']\\s*:\\s*["']${escapeRegExp(form)}["']`, "i")
  );
  if (asValue?.[1]) {
    return asValue[1];
  }
  return undefined;
}

function extractStringKeys(line: string): string[] {
  const keys: string[] = [];
  const re = /["']([a-z][a-z0-9_]*)["']\s*:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match[1]) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function dedupeExtendPoints(points: CapabilityExtendHint[]): CapabilityExtendHint[] {
  const seen = new Set<string>();
  const out: CapabilityExtendHint[] = [];
  for (const point of points) {
    const key = `${point.line ?? ""}:${point.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(point);
  }
  return out;
}

/** Format evidence block for the model (unit tests assert this text). */
export function formatExistingCapabilityEvidenceBlock(evidence: ExistingCapabilityEvidence): string {
  const lines: string[] = [];
  lines.push("<existing_capability_evidence>");
  lines.push(`open_file: ${evidence.filePath}`);
  lines.push(`asked_capability: ${evidence.capability} (label: ${evidence.capabilityLabel})`);
  lines.push(`verdict: ${evidence.verdict}`);
  lines.push("");

  if (evidence.verdict === "already-exists") {
    lines.push("## Verdict (required)");
    lines.push(
      `- **Already exists** — \`${evidence.capability}\` is defined in open-file evidence. Do **not** propose greenfield “add a new ${evidence.capability} type.”`
    );
    lines.push("- Answer must say the relation/capability **already exists** and recommend **extend**.");
    lines.push("");
    lines.push("## Evidence hits");
    for (const hit of evidence.hits.slice(0, 12)) {
      const pair = hit.pairedWith ? ` ↔ ${hit.pairedWith}` : "";
      lines.push(`- L${hit.line} (${hit.kind}${pair}): \`${hit.snippet}\``);
    }
    lines.push("");
    lines.push("## Extend points (prefer these over add-new)");
    if (evidence.extendPoints.length === 0) {
      lines.push("- Extend consumers of the existing symbol; do not re-declare it.");
    } else {
      for (const point of evidence.extendPoints) {
        const loc = point.line ? `L${point.line}: ` : "";
        lines.push(`- ${loc}${point.summary}`);
        if (point.snippet) {
          lines.push(`  \`${point.snippet}\``);
        }
      }
    }
    if (evidence.relatedSymbols.length) {
      lines.push("");
      lines.push("## Related symbols in open file");
      for (const sym of evidence.relatedSymbols) {
        lines.push(`- \`${sym}\``);
      }
    }
  } else {
    lines.push("## Verdict (required)");
    lines.push(
      `- **Add-new allowed** — \`${evidence.capability}\` was **not** found in open-file evidence.`
    );
    lines.push(
      "- You may design an add path, but still search the module for parallel patterns; do not invent unrelated APIs."
    );
  }

  lines.push("");
  lines.push("## Honest gaps");
  for (const gap of evidence.gaps) {
    lines.push(`- ${gap}`);
  }
  lines.push("</existing_capability_evidence>");
  return lines.join("\n");
}

/** Full user-prompt shaping for feature-add plain chat with open-file grounding. */
export function buildExistingCapabilitySynthesisUserPrompt(options: {
  ask: string;
  evidence: ExistingCapabilityEvidence;
  userMessage?: string;
}): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(options.ask.trim() || "Assess whether the asked capability already exists before adding it.");
  lines.push("");
  lines.push("## Existing-capability answer contract (required)");
  lines.push(
    "This is a ticket-style add-feature ask with a starter file open. You must ground on `<existing_capability_evidence>`:"
  );

  if (options.evidence.verdict === "already-exists") {
    lines.push(
      `1. **Summary** — state that \`${options.evidence.capability}\` **already exists** in \`${options.evidence.filePath}\` (cite a hit line).`
    );
    lines.push("2. **Your question** — recommend **extend**, not greenfield add-new.");
    lines.push("3. **Extend points** — name validation / ViewSet / consumer surfaces from the evidence block.");
    lines.push(
      `4. **Do not** propose adding a duplicate \`${options.evidence.capability}\` relation/type while evidence defines it.`
    );
    lines.push("5. **Gaps** — only claim APIs present in evidence.");
    lines.push("");
    lines.push("PASS: “already exists” + extend guidance with mapper/validation cite.");
    lines.push(`FAIL: greenfield “add new ${options.evidence.capability} type” while evidence shows it.`);
  } else {
    lines.push(
      `1. **Summary** — \`${options.evidence.capability}\` was not found in the open file; **add-new** is allowed.`
    );
    lines.push("2. **Your question** — propose an add path consistent with patterns in the open file.");
    lines.push("3. **Still search** — mirror existing sibling keys/types; do not invent parallel systems.");
    lines.push("4. **Gaps** — say what the open file does not show.");
    lines.push("");
    lines.push("PASS: add-new only when the symbol is absent from evidence.");
    lines.push("FAIL: claim it already exists without a hit.");
  }

  lines.push("");
  lines.push(formatExistingCapabilityEvidenceBlock(options.evidence));
  lines.push("");
  if (options.userMessage?.trim() && options.userMessage.trim() !== options.ask.trim()) {
    lines.push("## User message");
    lines.push(options.userMessage.trim());
  }
  return lines.join("\n");
}

/** Test helper: shaped synthesis mentions already-exists / extend path. */
export function shapedEvidenceRequiresExtend(shaped: string): boolean {
  return (
    /already exists/i.test(shaped) &&
    /\bextend\b/i.test(shaped) &&
    /verdict:\s*already-exists/i.test(shaped)
  );
}

/** Test helper: shaped synthesis allows add-new. */
export function shapedEvidenceAllowsAddNew(shaped: string): boolean {
  return /verdict:\s*add-new/i.test(shaped) && /add-new allowed/i.test(shaped);
}

/**
 * Post-process: if evidence says already-exists but the model proposed greenfield add,
 * prepend a corrective lead-in. Does not invent APIs.
 */
export function enrichExistingCapabilityResponse(
  content: string,
  evidence: ExistingCapabilityEvidence
): string {
  if (evidence.verdict !== "already-exists") {
    return content;
  }
  const trimmed = content.trim();
  const acknowledges =
    /already exists/i.test(trimmed) ||
    (new RegExp(`\\b${escapeRegExp(evidence.capability)}\\b`, "i").test(trimmed) &&
      /\bextend\b/i.test(trimmed));

  const proposesGreenfield =
    /\b(?:add(?:ing)?\s+(?:a\s+)?new|introduce\s+(?:a\s+)?new|create\s+(?:a\s+)?new)\b/i.test(
      trimmed
    ) &&
    new RegExp(`\\b${escapeRegExp(evidence.capability)}\\b|\\b${escapeRegExp(evidence.capabilityLabel)}\\b`, "i").test(
      trimmed
    );

  if (acknowledges && !proposesGreenfield) {
    return content;
  }

  const hit = evidence.hits[0];
  const cite = hit
    ? ` (see \`${evidence.filePath}\` L${hit.line})`
    : ` (see \`${evidence.filePath}\`)`;
  const extend =
    evidence.extendPoints[0]?.summary ??
    `Extend consumers / validation that use \`${evidence.capability}\` — do not add a duplicate type.`;

  const lead = [
    "**Already exists — extend, don’t add new**",
    "",
    `\`${evidence.capability}\` **already exists** in open-file evidence${cite}.`,
    extend,
    ""
  ].join("\n");

  if (!trimmed) {
    return lead.trim();
  }
  if (acknowledges) {
    // Model acknowledged but also proposed greenfield — keep lead for clarity.
    return `${lead}${trimmed}`;
  }
  return `${lead}${trimmed}`;
}
