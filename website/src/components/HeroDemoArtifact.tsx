"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ConfluenceIcon,
  GitHubIcon,
  GoogleDocsIcon,
  JiraIcon,
  NotionIcon,
  SlackIcon,
  TeamsIcon
} from "./logos/brand-icons";
import {
  HERO_EDIT_PATCH_LINES,
  HERO_JIRA_PATCH_LINES,
  HeroPatchDemoCard,
  type HeroPatchLine,
  type HeroPatchPhase
} from "./HeroPatchDemoCard";
import {
  HERO_COMPLETE_GHOST_SUFFIX,
  HERO_COMPLETE_PREFIX_LINES,
  HERO_COMPLETE_TYPED_PREFIX,
  HeroCompleteDemoCard,
  type HeroCompletePhase
} from "./HeroCompleteDemoCard";

type ContextItem = {
  label: string;
  desc: string;
  status: "done" | "loading";
};

type ProseScenario = {
  kind?: "prose";
  question: string;
  /** Filenames/paths in the question that turn blue once fully typed (extension file-link style). */
  questionFiles?: string[];
  context: ContextItem[];
  response: {
    summary: string;
    code?: string;
    codeFile?: string;
  };
};

type PatchScenario = {
  kind: "patch";
  question: string;
  questionFiles?: string[];
  context: ContextItem[];
  patch: {
    file: string;
    meta: string;
    lines: HeroPatchLine[];
  };
};

type CompleteScenario = {
  kind: "complete";
  question: string;
  questionFiles?: string[];
  context: ContextItem[];
  complete: {
    file: string;
    prefixLines: string[];
    typedPrefix: string;
    ghostSuffix: string;
  };
};

type Scenario = ProseScenario | PatchScenario | CompleteScenario;

const SCENARIOS: Scenario[] = [
  {
    kind: "patch",
    question:
      "Rewrite the selected refresh-token branch in oauth_refresh.ts. Match AuthError rejection from token_validator.ts.",
    questionFiles: ["oauth_refresh.ts", "token_validator.ts"],
    context: [
      { label: "Symbol graph", desc: "refreshOAuthToken() · AuthError usages · 3 callers", status: "done" },
      { label: "GitHub · token_validator.ts", desc: "AuthError('empty_or_unsigned_payload')", status: "done" },
      { label: "Pattern match", desc: "billing/auth rejection semantics", status: "done" },
      { label: "Selection", desc: "oauth_refresh.ts · lines 44–46 highlighted", status: "loading" }
    ],
    patch: {
      file: "oauth_refresh.ts",
      meta: "1 file · 1 edit",
      lines: HERO_EDIT_PATCH_LINES
    }
  },
  {
    kind: "complete",
    question:
      "Complete the empty-payload guard in token_validator.ts. Match the AuthError pattern from billing/auth.",
    questionFiles: ["token_validator.ts"],
    context: [
      { label: "Symbol graph", desc: "validateSession() · AuthError usages · 3 callers", status: "done" },
      { label: "GitHub · billing/auth", desc: "AuthError('empty_or_unsigned_payload')", status: "done" },
      { label: "Dependents", desc: "3 importers require matching guard semantics", status: "done" },
      { label: "Open file", desc: "token_validator.ts · cursor at line 5", status: "loading" }
    ],
    complete: {
      file: "token_validator.ts",
      prefixLines: HERO_COMPLETE_PREFIX_LINES,
      typedPrefix: HERO_COMPLETE_TYPED_PREFIX,
      ghostSuffix: HERO_COMPLETE_GHOST_SUFFIX
    }
  },
  {
    question: "What's the impact of changing the auth middleware?",
    context: [
      { label: "Symbol graph", desc: "AuthMiddleware.validate() · 23 dependents", status: "done" },
      { label: "GitHub · api-gateway", desc: "4 importers · runtime dependency", status: "done" },
      { label: "GitHub · webhook-processor", desc: "2 importers · auth middleware chain", status: "done" },
      { label: "GitLab · billing-worker", desc: "batch retry path imports validate()", status: "loading" },
      { label: "Slack · #platform-auth", desc: "Thread on auth refactor · Sep 18", status: "done" }
    ],
    response: {
      summary:
        "**Short answer:** 23 dependents across 6 repos. Signature or empty-payload changes break api-gateway and webhook-processor.\n\n**Downstream impact:**\n• api-gateway: 4 runtime importers in the auth middleware chain\n• webhook-processor: validate() called before every inbound handler\n• billing-worker (GitLab): batch retry path imports the same module\n\n**From your stack:** Slack #platform-auth discussed this Sep 18. Loop in @jessica_dawson (90% blame on auth_middleware.go) before merging."
    }
  },
  {
    kind: "patch",
    question:
      "Implement the null guard from PLATFORM-2847 in webhook-processor. Match api-gateway PR #891 before validate().",
    questionFiles: ["webhook-processor"],
    context: [
      { label: "Jira · PLATFORM-2847", desc: "Null check missing in webhook auth path", status: "done" },
      { label: "GitHub · api-gateway PR #891", desc: "Reject unauthorized payloads before validate()", status: "done" },
      { label: "Symbol graph", desc: "AuthMiddleware.validate() · 4 importers", status: "done" },
      { label: "Slack · #platform-bugs", desc: "Reported in thread · Oct 3", status: "done" }
    ],
    patch: {
      file: "workers/webhook-processor/auth.ts",
      meta: "1 file · 1 edit · PLATFORM-2847",
      lines: HERO_JIRA_PATCH_LINES
    }
  },
  {
    question: "Why was this pattern chosen?",
    context: [
      { label: "GitHub · api-gateway", desc: "PR #412 · introduced validate() wrapper", status: "done" },
      { label: "Confluence · Auth ADR", desc: "Centralized middleware over per-route checks", status: "done" },
      { label: "Slack · #architecture", desc: "Decision thread · Mar 2024", status: "done" },
      { label: "Symbol graph", desc: "AuthMiddleware.validate() · 23 dependents", status: "done" }
    ],
    response: {
      summary:
        "**Short answer:** PR #412 centralized validation per the Auth ADR: one middleware wrapper instead of per-route checks.\n\n**Decision trail:**\n• Jira PROJ-1847: \"Add zero-retention headers to middleware\"\n• Slack #architecture: Marcus proposed the wrapper Mar 2024; Elena confirmed with security\n• Confluence Auth RFC v2: linked from the PR description\n\nThe pattern that shipped:",
      codeFile: "api-gateway/middleware/auth_middleware.go:88-96",
      code:
        "func (m *AuthMiddleware) Validate(next http.Handler) http.Handler {\n  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n    if err := m.validateSession(r); err != nil {\n      writeUnauthorized(w, err)\n      return\n    }\n    next.ServeHTTP(w, r)\n  })\n}"
    }
  },
  {
    question: "What breaks if I refactor this?",
    context: [
      { label: "Symbol graph", desc: "23 dependents across 6 repos", status: "done" },
      { label: "GitHub · billing-worker", desc: "batch retry imports validate()", status: "done" },
      { label: "GitHub · webhook-processor", desc: "auth middleware chain", status: "done" },
      { label: "Jira · PLATFORM-1102", desc: "Open ticket · refactor blocked on auth", status: "done" }
    ],
    response: {
      summary:
        "**Short answer:** 6 services break on a signature change. Billing-worker batch retry and webhook-processor auth chain fail first.\n\n**Blast radius:**\n• billing-worker: batch retry imports validate() on every job tick\n• webhook-processor: auth middleware chain assumes current error shapes\n• api-gateway: 4 importers share the runtime dependency\n\nFirst break site in the graph:",
      codeFile: "workers/billing-worker/retry.go:54-61",
      code:
        "func (w *BatchRetry) tick(ctx context.Context, job Job) error {\n  payload, err := w.loadPayload(job)\n  if err != nil {\n    return err\n  }\n  // Signature change here breaks every retry loop\n  return auth.Validate(ctx, payload)\n}"
    }
  }
];

const TOOLS = [
  {
    id: "tool-github",
    label: "GitHub",
    delay: "0s",
    icon: <GitHubIcon className="h-5 w-5" />
  },
  {
    id: "tool-slack",
    label: "Slack",
    delay: "0.1s",
    icon: <SlackIcon className="h-5 w-5" />
  },
  {
    id: "tool-jira",
    label: "Jira",
    delay: "0.2s",
    icon: <JiraIcon className="h-5 w-5" />
  },
  {
    id: "tool-notion",
    label: "Notion",
    delay: "0.3s",
    icon: <NotionIcon className="h-5 w-5" />
  },
  {
    id: "tool-teams",
    label: "Teams",
    delay: "0.4s",
    icon: <TeamsIcon className="h-5 w-5" />
  },
  {
    id: "tool-confluence",
    label: "Confluence",
    delay: "0.5s",
    icon: <ConfluenceIcon className="h-5 w-5" />
  },
  {
    id: "tool-gdocs",
    label: "Google Docs",
    delay: "0.6s",
    icon: <GoogleDocsIcon className="h-5 w-5" />
  },
  {
    id: "tool-codeowners",
    label: "Codeowners",
    delay: "0.7s",
    icon: <div className="hero-demo-code-icon">{"{}"}</div>
  },
  {
    id: "tool-symbols",
    label: "Symbol graph",
    delay: "0.8s",
    icon: <div className="hero-demo-code-icon">◇</div>
  }
];

const DEMO_MESSAGE_CARD = "rounded-lg border border-gray-200 bg-gray-50 p-4";

const TIMING = {
  questionCharMs: 26,
  afterQuestionMs: 850,
  stage2Ms: 1900,
  stage3Ms: 2100,
  /** Start response stream this long before stage 4 so text is moving but no large hidden chunk appears. */
  responsePrefetchMs: 550,
  responseCharsPerSec: 72,
  codeCharsPerSec: 88,
  beforeCodeMs: 180,
  /** Min/max dwell after response finishes streaming (ms) */
  responseHoldMinMs: 2200,
  responseHoldMaxMs: 3800,
  /** Patch card choreography */
  patchDiffLineMs: 220,
  patchActionsMs: 450,
  patchAimMs: 900,
  patchClickMs: 320,
  patchAppliedHoldMs: 2800,
  /** Inline complete choreography */
  completeGhostCharsPerSec: 56,
  completeTabAimMs: 850,
  completeTabPressMs: 300,
  completeAcceptedHoldMs: 2600
};

type Stage = 1 | 2 | 3 | 4;

function stageClass(active: boolean) {
  return active ? "hero-demo-stage-visible" : "hero-demo-stage-hidden";
}

type QuestionSegment = { type: "text" | "file"; value: string };

/** Split question into plain text and highlighted file spans (in order of appearance). */
function buildQuestionSegments(question: string, files: string[]): QuestionSegment[] {
  if (files.length === 0) return [{ type: "text", value: question }];

  const segments: QuestionSegment[] = [];
  let cursor = 0;

  for (const file of files) {
    const idx = question.indexOf(file, cursor);
    if (idx === -1) continue;
    if (idx > cursor) {
      segments.push({ type: "text", value: question.slice(cursor, idx) });
    }
    segments.push({ type: "file", value: file });
    cursor = idx + file.length;
  }

  if (cursor < question.length) {
    segments.push({ type: "text", value: question.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: question }];
}

/** Renders typed question; file spans turn blue once the full filename has been typed. */
function renderTypedQuestion(typed: string, question: string, files?: string[]): React.ReactNode {
  const segments = buildQuestionSegments(question, files ?? []);
  let remaining = typed.length;
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const segment of segments) {
    if (remaining <= 0) break;
    const visibleLen = Math.min(remaining, segment.value.length);
    const slice = segment.value.slice(0, visibleLen);
    const fileComplete = segment.type === "file" && visibleLen === segment.value.length;

    nodes.push(
      fileComplete ? (
        <span key={key++} className="text-blue-500">
          {slice}
        </span>
      ) : (
        <span key={key++}>{slice}</span>
      )
    );
    remaining -= visibleLen;
  }

  return nodes;
}

/** Brief beat after stream ends — scales with length, capped so loops don't feel stuck. */
function completedResponseHoldMs(summary: string, code?: string): number {
  const totalChars = summary.length + (code?.length ?? 0);
  const scaled = 1600 + totalChars * 3.5;
  return Math.min(TIMING.responseHoldMaxMs, Math.max(TIMING.responseHoldMinMs, scaled));
}

function isPatchScenario(scenario: Scenario): scenario is PatchScenario {
  return scenario.kind === "patch";
}

function isCompleteScenario(scenario: Scenario): scenario is CompleteScenario {
  return scenario.kind === "complete";
}

function patchDiffLineCount(scenario: PatchScenario): number {
  return scenario.patch.lines.filter((l) => l.kind !== "context").length;
}

/** Parse `path:12-18` or `path:12` from a cite-style codeFile label. */
function parseCiteCodeFile(codeFile: string): { path: string; startLine: number | null } {
  const match = codeFile.match(/^(.*?):(\d+)(?:-\d+)?$/);
  if (!match) return { path: codeFile, startLine: null };
  return { path: match[1], startLine: Number(match[2]) };
}

/** Render streamed code with optional starting line numbers (cite-style). */
function renderCitedCodeLines(code: string, startLine: number | null, showCursor: boolean) {
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          {startLine != null ? (
            <span className="w-6 shrink-0 select-none text-right text-gray-400">
              {startLine + i}
            </span>
          ) : null}
          <span className="min-w-0 whitespace-pre">{line || " "}</span>
        </div>
      ))}
      {showCursor ? <span className="hero-demo-response-cursor text-blue-500">|</span> : null}
    </>
  );
}

/** Hide a trailing lone `*` while the opening `**` is still being typed. */
function hidePartialBoldMarker(text: string): string {
  if (text.endsWith("*") && !text.endsWith("**")) {
    return text.slice(0, -1);
  }
  return text;
}

/** Renders `**bold**` markers in streamed text (Coop-style section headings). */
function renderStreamedBoldText(text: string): React.ReactNode {
  const sanitized = hidePartialBoldMarker(text);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < sanitized.length) {
    const open = sanitized.indexOf("**", i);
    if (open === -1) {
      nodes.push(sanitized.slice(i));
      break;
    }
    if (open > i) nodes.push(sanitized.slice(i, open));

    const close = sanitized.indexOf("**", open + 2);
    if (close === -1) {
      // Still streaming inside a heading — render as bold immediately (no visible **).
      const content = sanitized.slice(open + 2);
      if (content) {
        nodes.push(
          <strong key={key++} className="font-semibold text-gray-900">
            {content}
          </strong>
        );
      }
      break;
    }

    nodes.push(
      <strong key={key++} className="font-semibold text-gray-900">
        {sanitized.slice(open + 2, close)}
      </strong>
    );
    i = close + 2;
  }

  return nodes;
}

/** Smooth constant-rate text reveal via rAF (avoids per-char setTimeout stutter). */
function streamTextSmooth(
  text: string,
  charsPerSec: number,
  onUpdate: (slice: string) => void,
  isActive: () => boolean,
  onRaf: (id: number) => void
): Promise<void> {
  if (!text) return Promise.resolve();

  onUpdate(text.slice(0, 1));
  let lastLen = 1;
  const start = performance.now();

  return new Promise((resolve) => {
    const tick = (now: number) => {
      if (!isActive()) {
        resolve();
        return;
      }

      const targetLen = Math.min(
        text.length,
        Math.max(1, Math.floor(((now - start) / 1000) * charsPerSec))
      );

      if (targetLen > lastLen) {
        lastLen = targetLen;
        onUpdate(text.slice(0, targetLen));
      }

      if (targetLen < text.length) {
        onRaf(requestAnimationFrame(tick));
      } else {
        resolve();
      }
    };

    onRaf(requestAnimationFrame(tick));
  });
}

export function HeroDemoArtifact() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stage, setStage] = useState<Stage>(1);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [streamedSummary, setStreamedSummary] = useState("");
  const [streamedCode, setStreamedCode] = useState("");
  const [responseStreaming, setResponseStreaming] = useState(false);
  const [patchPhase, setPatchPhase] = useState<HeroPatchPhase>("building");
  const [revealedDiffLines, setRevealedDiffLines] = useState(0);
  const [completePhase, setCompletePhase] = useState<HeroCompletePhase>("typing");
  const [revealedGhostChars, setRevealedGhostChars] = useState(0);
  const [paused, setPaused] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const responseStreamTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const responseRafRef = useRef<number | null>(null);
  const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  const questionRunIdRef = useRef(0);
  const responseRunIdRef = useRef(0);
  const reduceMotionRef = useRef(false);

  const scenario = SCENARIOS[scenarioIndex];
  const patchScenario = isPatchScenario(scenario) ? scenario : null;
  const completeScenario = isCompleteScenario(scenario) ? scenario : null;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reduceMotionRef.current = mq.matches;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const clearQuestionTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (typeIntervalRef.current) {
      clearInterval(typeIntervalRef.current);
      typeIntervalRef.current = null;
    }
    questionRunIdRef.current += 1;
  }, []);

  const cancelResponseStream = useCallback(() => {
    responseRunIdRef.current += 1;
    responseStreamTimersRef.current.forEach(clearTimeout);
    responseStreamTimersRef.current = [];
    if (responseRafRef.current != null) {
      cancelAnimationFrame(responseRafRef.current);
      responseRafRef.current = null;
    }
  }, []);

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const advanceScenario = useCallback(() => {
    if (pausedRef.current) return;
    cancelResponseStream();
    setStage(1);
    setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
  }, [cancelResponseStream]);

  const startResponseStream = useCallback(
    (index: number) => {
      const runId = ++responseRunIdRef.current;
      responseStreamTimersRef.current.forEach(clearTimeout);
      responseStreamTimersRef.current = [];
      if (responseRafRef.current != null) {
        cancelAnimationFrame(responseRafRef.current);
        responseRafRef.current = null;
      }

      const active = SCENARIOS[index];
      let cancelled = false;

      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          const id = setTimeout(() => {
            if (!cancelled && runId === responseRunIdRef.current) resolve();
          }, ms);
          responseStreamTimersRef.current.push(id);
        });

      const waitWhilePaused = async () => {
        while (pausedRef.current && !cancelled && runId === responseRunIdRef.current) {
          await wait(120);
        }
      };

      const isActive = () => !cancelled && runId === responseRunIdRef.current;
      const trackRaf = (id: number) => {
        responseRafRef.current = id;
      };

      async function streamPatch(patch: PatchScenario) {
        const diffCount = patchDiffLineCount(patch);
        setStreamedSummary("");
        setStreamedCode("");
        setPatchPhase("building");
        setRevealedDiffLines(0);
        setCompletePhase("typing");
        setRevealedGhostChars(0);
        setResponseStreaming(true);

        if (reduceMotionRef.current) {
          setRevealedDiffLines(diffCount);
          setPatchPhase("applied");
          setResponseStreaming(false);
          await wait(TIMING.patchAppliedHoldMs);
          if (isActive()) advanceScenario();
          return;
        }

        for (let i = 1; i <= diffCount; i += 1) {
          if (!isActive()) return;
          await wait(TIMING.patchDiffLineMs);
          if (!isActive()) return;
          setRevealedDiffLines(i);
        }

        if (!isActive()) return;
        await wait(TIMING.patchActionsMs);
        if (!isActive()) return;
        setPatchPhase("ready");
        setResponseStreaming(false);

        await waitWhilePaused();
        if (!isActive()) return;
        await wait(TIMING.patchAimMs);
        if (!isActive()) return;
        setPatchPhase("clicking");
        await wait(TIMING.patchClickMs);
        if (!isActive()) return;
        setPatchPhase("applied");

        await waitWhilePaused();
        if (!isActive()) return;
        await wait(TIMING.patchAppliedHoldMs);
        if (isActive()) advanceScenario();
      }

      async function streamComplete(complete: CompleteScenario) {
        const ghost = complete.complete.ghostSuffix;
        setStreamedSummary("");
        setStreamedCode("");
        setPatchPhase("building");
        setRevealedDiffLines(0);
        setCompletePhase("typing");
        setRevealedGhostChars(0);
        setResponseStreaming(true);

        if (reduceMotionRef.current) {
          setRevealedGhostChars(ghost.length);
          setCompletePhase("accepted");
          setResponseStreaming(false);
          await wait(TIMING.completeAcceptedHoldMs);
          if (isActive()) advanceScenario();
          return;
        }

        setCompletePhase("ghost");
        await streamTextSmooth(
          ghost,
          TIMING.completeGhostCharsPerSec,
          (slice) => setRevealedGhostChars(slice.length),
          isActive,
          trackRaf
        );
        if (!isActive()) return;

        responseRafRef.current = null;
        setCompletePhase("tab-ready");
        setResponseStreaming(false);

        await waitWhilePaused();
        if (!isActive()) return;
        await wait(TIMING.completeTabAimMs);
        if (!isActive()) return;
        setCompletePhase("tab-press");
        await wait(TIMING.completeTabPressMs);
        if (!isActive()) return;
        setCompletePhase("accepted");

        await waitWhilePaused();
        if (!isActive()) return;
        await wait(TIMING.completeAcceptedHoldMs);
        if (isActive()) advanceScenario();
      }

      async function streamProse(prose: ProseScenario) {
        const { summary, code } = prose.response;
        setStreamedSummary("");
        setStreamedCode("");
        setPatchPhase("building");
        setRevealedDiffLines(0);
        setCompletePhase("typing");
        setRevealedGhostChars(0);

        if (reduceMotionRef.current) {
          setStreamedSummary(summary);
          setStreamedCode(code ?? "");
          setResponseStreaming(false);
          await wait(completedResponseHoldMs(summary, code));
          if (isActive()) advanceScenario();
          return;
        }

        setResponseStreaming(true);

        await streamTextSmooth(
          summary,
          TIMING.responseCharsPerSec,
          setStreamedSummary,
          isActive,
          trackRaf
        );
        if (!isActive()) return;

        if (code) {
          await wait(TIMING.beforeCodeMs);
          if (!isActive()) return;
          await streamTextSmooth(code, TIMING.codeCharsPerSec, setStreamedCode, isActive, trackRaf);
        }

        if (!isActive()) return;
        responseRafRef.current = null;
        setResponseStreaming(false);
        await waitWhilePaused();
        if (!isActive()) return;
        await wait(completedResponseHoldMs(summary, code));
        if (isActive()) advanceScenario();
      }

      if (isPatchScenario(active)) {
        streamPatch(active);
      } else if (isCompleteScenario(active)) {
        streamComplete(active);
      } else {
        streamProse(active);
      }
    },
    [advanceScenario]
  );

  const selectScenario = useCallback(
    (index: number) => {
      if (index === scenarioIndex) return;
      clearQuestionTimers();
      cancelResponseStream();
      setStage(1);
      setScenarioIndex(index);
    },
    [scenarioIndex, clearQuestionTimers, cancelResponseStream]
  );

  useEffect(() => {
    const query = SCENARIOS[scenarioIndex].question;
    const runId = ++questionRunIdRef.current;

    setTypedQuestion("");
    setStreamedSummary("");
    setStreamedCode("");
    setResponseStreaming(false);
    setPatchPhase("building");
    setRevealedDiffLines(0);
    setCompletePhase("typing");
    setRevealedGhostChars(0);

    const scheduleStagesAfterQuestion = () => {
      const stage3At = TIMING.afterQuestionMs + TIMING.stage2Ms;
      const stage4At = stage3At + TIMING.stage3Ms;
      const streamAt = Math.max(stage3At, stage4At - TIMING.responsePrefetchMs);

      addTimer(() => setStage(2), TIMING.afterQuestionMs);
      addTimer(() => setStage(3), stage3At);
      addTimer(() => startResponseStream(scenarioIndex), streamAt);
      addTimer(() => setStage(4), stage4At);
    };

    if (reduceMotionRef.current) {
      setTypedQuestion(query);
      setStage(1);
      addTimer(() => setStage(2), 0);
      addTimer(() => setStage(3), 300);
      addTimer(() => startResponseStream(scenarioIndex), 450);
      addTimer(() => setStage(4), 600);
      return clearQuestionTimers;
    }

    setStage(1);

    let charIndex = 0;

    const typeNext = () => {
      if (runId !== questionRunIdRef.current) return;
      charIndex += 1;
      setTypedQuestion(query.slice(0, charIndex));
      if (charIndex >= query.length) {
        if (typeIntervalRef.current) {
          clearInterval(typeIntervalRef.current);
          typeIntervalRef.current = null;
        }
        scheduleStagesAfterQuestion();
      }
    };

    typeNext();
    typeIntervalRef.current = setInterval(typeNext, TIMING.questionCharMs);

    return clearQuestionTimers;
  }, [scenarioIndex, addTimer, clearQuestionTimers, startResponseStream]);

  const proseScenario =
    !patchScenario && !completeScenario && scenario.kind !== "patch" && scenario.kind !== "complete"
      ? scenario
      : null;
  const summaryComplete = proseScenario
    ? streamedSummary.length >= proseScenario.response.summary.length
    : false;
  const codeText = proseScenario?.response.code ?? "";
  const showSummaryCursor =
    stage === 4 &&
    !!proseScenario &&
    responseStreaming &&
    streamedSummary.length > 0 &&
    !summaryComplete;
  const showCodeCursor =
    stage === 4 &&
    !!proseScenario &&
    responseStreaming &&
    summaryComplete &&
    codeText.length > 0 &&
    streamedCode.length < codeText.length;

  const responseLabel = patchScenario ? "// edit" : completeScenario ? "// complete" : "// response";

  return (
    <div
      className="hero-demo-artifact"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="hero-demo-section">
        <div className={`hero-demo-stage ${stageClass(stage === 1)}`}>
          <div className="mb-4 font-mono text-sm text-gray-500">// question</div>
          <div className={DEMO_MESSAGE_CARD}>
            <p className="font-mono text-sm leading-relaxed text-gray-800">
              {renderTypedQuestion(typedQuestion, scenario.question, scenario.questionFiles)}
              {stage === 1 ? <span className="hero-demo-response-cursor text-blue-500">|</span> : null}
            </p>
          </div>
        </div>

        <div className={`hero-demo-stage ${stageClass(stage === 2)}`}>
          <div className="mb-6 font-mono text-sm text-gray-500">// pulling context from</div>
          <div className="grid grid-cols-3 gap-6">
            {TOOLS.map((tool) => (
              <div
                key={tool.id}
                className="hero-demo-logo-container hero-demo-scatter-animation"
                style={{ animationDelay: tool.delay }}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`hero-demo-stage ${stageClass(stage === 3)}`}>
          <div className="mb-4 font-mono text-sm text-gray-500">// context found</div>
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            {scenario.context.map((item, i) => (
              <div
                key={`${scenarioIndex}-${item.label}`}
                className="hero-demo-context-item hero-demo-context-card"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="flex items-start gap-2">
                  {item.status === "loading" ? (
                    <span className="hero-demo-loading-spinner">⟳</span>
                  ) : (
                    <span className="hero-demo-checkmark">✓</span>
                  )}
                  <div className="flex-1">
                    <div className="hero-demo-context-item-label">{item.label}</div>
                    <div className="hero-demo-context-item-desc">{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`hero-demo-stage ${stageClass(stage === 4)}`}>
          <div className="mb-4 flex items-center gap-2 font-mono text-sm text-gray-500">
            <span>{responseLabel}</span>
            {responseStreaming ? (
              <span className="hero-demo-streaming-indicator" aria-hidden="true">
                <span className="hero-demo-streaming-dot" />
                <span className="hero-demo-streaming-dot" />
                <span className="hero-demo-streaming-dot" />
              </span>
            ) : null}
          </div>
          {patchScenario ? (
            <HeroPatchDemoCard
              file={patchScenario.patch.file}
              meta={patchScenario.patch.meta}
              lines={patchScenario.patch.lines}
              revealedDiffLines={revealedDiffLines}
              phase={patchPhase}
            />
          ) : completeScenario ? (
            <HeroCompleteDemoCard
              file={completeScenario.complete.file}
              prefixLines={completeScenario.complete.prefixLines}
              typedPrefix={completeScenario.complete.typedPrefix}
              ghostSuffix={completeScenario.complete.ghostSuffix}
              revealedGhostChars={revealedGhostChars}
              phase={completePhase}
            />
          ) : (
            <div className={`${DEMO_MESSAGE_CARD} space-y-4`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {renderStreamedBoldText(streamedSummary)}
                {showSummaryCursor ? (
                  <span className="hero-demo-response-cursor text-blue-500">|</span>
                ) : null}
              </p>
              {codeText && summaryComplete && (streamedCode.length > 0 || showCodeCursor) ? (
                <pre className="overflow-x-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800">
                  {proseScenario?.response.codeFile
                    ? (() => {
                        const cite = parseCiteCodeFile(proseScenario.response.codeFile);
                        return (
                          <>
                            <span className="mb-2 block border-b border-gray-100 pb-1.5 font-mono text-[11px] normal-case tracking-normal text-blue-500">
                              {cite.path}
                              {cite.startLine != null ? (
                                <span className="text-gray-400">
                                  :
                                  {proseScenario.response.codeFile.split(":").slice(1).join(":")}
                                </span>
                              ) : null}
                            </span>
                            {renderCitedCodeLines(streamedCode, cite.startLine, showCodeCursor)}
                          </>
                        );
                      })()
                    : (
                      <>
                        {streamedCode}
                        {showCodeCursor ? (
                          <span className="hero-demo-response-cursor text-blue-500">|</span>
                        ) : null}
                      </>
                    )}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <div className="flex items-center gap-2" role="tablist" aria-label="Demo scenarios">
          {SCENARIOS.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === scenarioIndex}
              aria-label={`Show demo scenario ${i + 1}`}
              onClick={() => selectScenario(i)}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === scenarioIndex ? "w-6 bg-gray-900" : "w-1.5 bg-gray-200 hover:bg-gray-300"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
