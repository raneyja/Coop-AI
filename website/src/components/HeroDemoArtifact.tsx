"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConfluenceIcon,
  GitHubIcon,
  GoogleDocsIcon,
  JiraIcon,
  NotionIcon,
  SlackIcon,
  TeamsIcon
} from "./logos/brand-icons";

type ContextItem = {
  label: string;
  desc: string;
  status: "done" | "loading";
};

type Scenario = {
  question: string;
  context: ContextItem[];
  response: {
    summary: string;
    code?: string;
  };
};

const SCENARIOS: Scenario[] = [
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
        "23 dependents across 6 repos. Highest risk: api-gateway and webhook-processor in the auth chain."
    }
  },
  {
    question: "Can you fix this bug by looking at the Jira ticket?",
    context: [
      { label: "Jira · PLATFORM-2847", desc: "Null check missing in webhook auth path", status: "done" },
      { label: "GitHub · webhook-processor", desc: "validate() called before payload parse", status: "done" },
      { label: "Symbol graph", desc: "AuthMiddleware.validate() · 4 importers", status: "done" },
      { label: "Slack · #platform-bugs", desc: "Reported in thread · Oct 3", status: "done" }
    ],
    response: {
      summary:
        "PLATFORM-2847: add a null guard before validate() in the webhook path — same pattern as api-gateway PR #891.",
      code: "if (payload == null) return unauthorized();\nawait AuthMiddleware.validate(req);"
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
        "Centralized in PR #412 per the Auth ADR — one middleware wrapper instead of per-route checks."
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
        "6 services break on signature change. billing-worker batch retry and webhook-processor auth chain fail first."
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

type Stage = 1 | 2 | 3 | 4;

function stageClass(active: boolean) {
  return active ? "hero-demo-stage-visible" : "hero-demo-stage-hidden";
}

export function HeroDemoArtifact() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stage, setStage] = useState<Stage>(1);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [paused, setPaused] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  const scenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (typeIntervalRef.current) {
      clearInterval(typeIntervalRef.current);
      typeIntervalRef.current = null;
    }
  }, []);

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const selectScenario = useCallback(
    (index: number) => {
      if (index === scenarioIndex) return;
      clearTimers();
      setScenarioIndex(index);
    },
    [scenarioIndex, clearTimers]
  );

  useEffect(() => {
    const query = SCENARIOS[scenarioIndex].question;
    setStage(1);
    setTypedQuestion("");

    let charIndex = 0;

    typeIntervalRef.current = setInterval(() => {
      charIndex += 1;
      setTypedQuestion(query.slice(0, charIndex));
      if (charIndex >= query.length) {
        if (typeIntervalRef.current) {
          clearInterval(typeIntervalRef.current);
          typeIntervalRef.current = null;
        }
        addTimer(() => setStage(2), 500);
        addTimer(() => setStage(3), 2500);
        addTimer(() => setStage(4), 5000);
        addTimer(() => {
          if (!pausedRef.current) {
            setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
          }
        }, 8500);
      }
    }, 30);

    return clearTimers;
  }, [scenarioIndex, addTimer, clearTimers]);

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
        <div className={`hero-demo-stage ${stageClass(stage === 1)} space-y-6`}>
          <div className="font-mono text-sm text-gray-500">// question</div>
          <div className="text-lg text-gray-900">
            <span className="font-mono">{typedQuestion}</span>
            {stage === 1 ? <span className="text-blue-500">|</span> : null}
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
          <div className="mb-4 font-mono text-sm text-gray-500">// response</div>
          <div className="hero-demo-context-card space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm leading-relaxed text-gray-700">{scenario.response.summary}</p>
            {scenario.response.code ? (
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800">
                {scenario.response.code}
              </pre>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3">
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
        <p className="text-center text-xs text-coop-muted">
          Plays prompt → context → outcome · advances when complete · hover to pause
        </p>
      </div>
    </div>
  );
}
