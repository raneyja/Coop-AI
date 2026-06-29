"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ContextItem = {
  label: string;
  desc: string;
  status: "done" | "loading";
};

type Scenario = {
  question: string;
  context: ContextItem[];
  response?: {
    summary: string;
    code: string;
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
    ]
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
    ]
  },
  {
    question: "What breaks if I refactor this?",
    context: [
      { label: "Symbol graph", desc: "23 dependents across 6 repos", status: "done" },
      { label: "GitHub · billing-worker", desc: "batch retry imports validate()", status: "done" },
      { label: "GitHub · webhook-processor", desc: "auth middleware chain", status: "done" },
      { label: "Jira · PLATFORM-1102", desc: "Open ticket · refactor blocked on auth", status: "done" }
    ]
  }
];

const TOOLS = [
  {
    id: "tool-github",
    label: "GitHub",
    delay: "0s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23000'%3E%3Cpath d='M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z'/%3E%3C/svg%3E"
        alt="GitHub"
        className="h-5 w-5 object-contain"
      />
    )
  },
  {
    id: "tool-slack",
    label: "Slack",
    delay: "0.1s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 127 127'%3E%3Cpath d='M27.2 80C27.2 88.4 20.8 95.2 12 95.2 5.2 95.2 0 89.6 0 82.8v-2.8h27.2v0zm0-13.6H0V28.8C0 20.4 6.4 13.6 15.2 13.6h12v53.6zm40 34.4c0-8.4 6.4-15.2 15.2-15.2 6.8 0 12 5.6 12 12.4v2.8H67.2v0zm0-13.6h27.2V28.8c0-8.4-6.4-15.2-15.2-15.2h-12v53.6zm40-40.8c-6.8 0-12-5.6-12-12.4V28h27.2v0c0 8.4-6.4 15.2-15.2 15.2zm-40 67.2c8.4 0 15.2 6.4 15.2 15.2 0 6.8-5.6 12-12.4 12h-2.8v-27.2zm13.6-40H28v27.2c0 8.4-6.4 15.2-15.2 15.2h12v-27.2z' fill='%23E01E5A'/%3E%3C/svg%3E"
        alt="Slack"
        className="h-5 w-5 object-contain"
      />
    )
  },
  {
    id: "tool-jira",
    label: "Jira",
    delay: "0.2s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230052CC'%3E%3Cpath d='M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3.73-9.73c1.17-1.17 3.07-1.17 4.24 0 1.17 1.17 1.17 3.07 0 4.24-1.17 1.17-3.07 1.17-4.24 0-1.17-1.17-1.17-3.07 0-4.24zM4.03 4.03c1.17-1.17 3.07-1.17 4.24 0 1.17 1.17 1.17 3.07 0 4.24-1.17 1.17-3.07 1.17-4.24 0-1.17-1.17-1.17-3.07 0-4.24zm0 11.94c1.17-1.17 3.07-1.17 4.24 0 1.17 1.17 1.17 3.07 0 4.24-1.17 1.17-3.07 1.17-4.24 0-1.17-1.17-1.17-3.07 0-4.24z'/%3E%3C/svg%3E"
        alt="Jira"
        className="h-5 w-5 object-contain"
      />
    )
  },
  {
    id: "tool-notion",
    label: "Notion",
    delay: "0.3s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23000'/%3E%3Ctext x='50' y='65' font-size='50' font-weight='bold' fill='%23fff' text-anchor='middle' font-family='Arial'%3EN%3C/text%3E%3C/svg%3E"
        alt="Notion"
        className="h-5 w-5 rounded-sm bg-black object-contain"
      />
    )
  },
  {
    id: "tool-teams",
    label: "Teams",
    delay: "0.4s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='2' y='2' width='5' height='5' fill='%235B5FC7'/%3E%3Crect x='9' y='2' width='5' height='5' fill='%23A4373A'/%3E%3Crect x='2' y='9' width='5' height='5' fill='%2357B8FF'/%3E%3Crect x='9' y='9' width='5' height='5' fill='%2350E6FF'/%3E%3C/svg%3E"
        alt="Teams"
        className="h-5 w-5 object-contain"
      />
    )
  },
  {
    id: "tool-confluence",
    label: "Confluence",
    delay: "0.5s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23172B4D'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/%3E%3C/svg%3E"
        alt="Confluence"
        className="h-5 w-5 object-contain"
      />
    )
  },
  {
    id: "tool-gdocs",
    label: "Google Docs",
    delay: "0.6s",
    icon: (
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%234285F4' rx='2'/%3E%3Ctext x='12' y='17' font-size='12' font-weight='bold' fill='%23fff' text-anchor='middle' font-family='Arial'%3ED%3C/text%3E%3C/svg%3E"
        alt="Google Docs"
        className="h-5 w-5 object-contain"
      />
    )
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
  const queryRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scenario = SCENARIOS[scenarioIndex];

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const advanceScenario = useCallback(() => {
    clearTimers();
    setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
    setTypedQuestion("");
    setStage(1);
  }, [clearTimers]);

  const showResponse = useCallback(() => {
    setStage(4);
    addTimer(advanceScenario, 3500);
  }, [addTimer, advanceScenario]);

  const showContext = useCallback(() => {
    setStage(3);
    const current = SCENARIOS[scenarioIndex];
    if (current.response) {
      addTimer(showResponse, 2500);
    } else {
      addTimer(advanceScenario, 3000);
    }
  }, [addTimer, advanceScenario, scenarioIndex, showResponse]);

  const showTools = useCallback(() => {
    setStage(2);
    addTimer(showContext, 2000);
  }, [addTimer, showContext]);

  const typeQuery = useCallback(() => {
    const query = SCENARIOS[scenarioIndex].question;
    setTypedQuestion("");
    let index = 0;

    const typeInterval = setInterval(() => {
      if (index < query.length) {
        setTypedQuestion((prev) => prev + query[index]);
        index++;
      } else {
        clearInterval(typeInterval);
        addTimer(showTools, 500);
      }
    }, 30);
  }, [addTimer, scenarioIndex, showTools]);

  useEffect(() => {
    if (stage !== 1 || typedQuestion !== "") return;
    typeQuery();
  }, [scenarioIndex, stage, typedQuestion, typeQuery]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <div className="hero-demo-artifact">
      <div className="hero-demo-section">
        <div className={`hero-demo-stage ${stageClass(stage === 1)} space-y-6`}>
          <div className="font-mono text-sm text-gray-500">// question</div>
          <div className="text-lg text-gray-900">
            <span ref={queryRef} className="font-mono">
              {typedQuestion}
            </span>
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

        {scenario.response ? (
          <div className={`hero-demo-stage ${stageClass(stage === 4)}`}>
            <div className="mb-4 font-mono text-sm text-gray-500">// response</div>
            <div className="hero-demo-context-card space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm leading-relaxed text-gray-700">{scenario.response.summary}</p>
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800">
                {scenario.response.code}
              </pre>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 text-center text-sm text-gray-600">
        Scenario {scenarioIndex + 1} of {SCENARIOS.length}
      </div>
    </div>
  );
}
