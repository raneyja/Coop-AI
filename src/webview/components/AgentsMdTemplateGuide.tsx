import React, { useState } from "react";
import { AGENTS_MD_TEMPLATE_SECTIONS } from "../lib/agentsMdTemplateGuide";

const GUIDE_PROMPT = "What should I include in my AGENTS.md file?";
const GUIDE_HIDE = "Hide AGENTS.md section guide";

type AgentsMdTemplateGuideProps = {
  className?: string;
};

/** Single collapsed disclosure — education on demand, not by default. */
export function AgentsMdTemplateGuide({ className }: AgentsMdTemplateGuideProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button
        type="button"
        className="coop-agents-md-guide-link"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? GUIDE_HIDE : GUIDE_PROMPT}
      </button>
      {open ? (
        <ul className="coop-agents-md-guide-list mt-2">
          {AGENTS_MD_TEMPLATE_SECTIONS.map((section) => (
            <li key={section.heading}>
              <span className="font-medium text-[var(--coop-panel-foreground)]">{section.heading}</span>
              {" — "}
              {section.shortDescription}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
