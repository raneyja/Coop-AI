"use client";

import { useEffect, useRef } from "react";

const SCENARIOS = [
  "What's the impact of changing the auth middleware?",
  "Who owns the payment system?",
  "Why was this pattern chosen?",
  "What breaks if I refactor this?"
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

const CONTEXT_ITEMS = [
  { label: "Symbol graph", desc: "AuthMiddleware.validate() · 23 dependents", status: "done" as const },
  { label: "GitHub · api-gateway", desc: "4 importers · runtime dependency", status: "done" as const },
  { label: "GitHub · webhook-processor", desc: "2 importers · auth middleware chain", status: "done" as const },
  { label: "GitLab · billing-worker", desc: "batch retry path imports validate()", status: "loading" as const },
  { label: "Slack · #platform-auth", desc: "Thread on auth refactor · Sep 18", status: "done" as const }
];

type Stage = 1 | 2 | 3;

export function HeroDemoArtifact() {
  const queryRef = useRef<HTMLSpanElement>(null);
  const scenarioRef = useRef<HTMLSpanElement>(null);
  const stage1Ref = useRef<HTMLDivElement>(null);
  const stage2Ref = useRef<HTMLDivElement>(null);
  const stage3Ref = useRef<HTMLDivElement>(null);
  const scenarioIndexRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const addTimer = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const setStage = (stage: Stage) => {
    const stages = [stage1Ref, stage2Ref, stage3Ref];
    stages.forEach((ref, i) => {
      if (!ref.current) return;
      const active = i + 1 === stage;
      ref.current.classList.toggle("hero-demo-stage-hidden", !active);
      ref.current.classList.toggle("hero-demo-stage-visible", active);
    });
  };

  const typeQuery = () => {
    const query = SCENARIOS[scenarioIndexRef.current];
    const queryEl = queryRef.current;
    if (!queryEl) return;

    queryEl.textContent = "";
    let index = 0;

    const typeInterval = setInterval(() => {
      if (index < query.length) {
        queryEl.textContent += query[index];
        index++;
      } else {
        clearInterval(typeInterval);
        addTimer(showTools, 500);
      }
    }, 30);
  };

  const showTools = () => {
    setStage(2);
    addTimer(showContext, 2000);
  };

  const showContext = () => {
    setStage(3);
    addTimer(nextScenario, 3000);
  };

  const nextScenario = () => {
    scenarioIndexRef.current = (scenarioIndexRef.current + 1) % SCENARIOS.length;
    if (scenarioRef.current) {
      scenarioRef.current.textContent = String(scenarioIndexRef.current + 1);
    }
    if (queryRef.current) {
      queryRef.current.textContent = "";
    }
    setStage(1);
    addTimer(typeQuery, 100);
  };

  useEffect(() => {
    typeQuery();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hero-demo-artifact">
      <div className="hero-demo-section">
        <div ref={stage1Ref} className="hero-demo-stage hero-demo-stage-visible space-y-6">
          <div className="font-mono text-sm text-gray-500">// question</div>
          <div className="text-lg text-gray-900">
            <span ref={queryRef} className="font-mono" />
            <span className="text-blue-500">|</span>
          </div>
        </div>

        <div ref={stage2Ref} className="hero-demo-stage hero-demo-stage-hidden">
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

        <div ref={stage3Ref} className="hero-demo-stage hero-demo-stage-hidden">
          <div className="mb-4 font-mono text-sm text-gray-500">// context found</div>
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            {CONTEXT_ITEMS.map((item, i) => (
              <div
                key={item.label}
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
      </div>

      <div className="mt-4 text-center text-sm text-gray-600">
        Scenario <span ref={scenarioRef}>1</span> of 4
      </div>
    </div>
  );
}
