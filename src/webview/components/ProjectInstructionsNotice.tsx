import React from "react";
import type { ProjectInstructionsState } from "../../chat/types";
import { agentsMdAttached, agentsMdStatusTitle, shouldPromptForAgentsMd } from "../lib/agentsMdStatus";
import { CoopNotice } from "./CoopNotice";

type ProjectInstructionsNoticeProps = {
  state?: ProjectInstructionsState;
  onAttach: () => void;
  onStartFromTemplate: () => void;
  onDismiss: () => void;
  className?: string;
};

export function ProjectInstructionsNotice({
  state,
  onAttach,
  onStartFromTemplate,
  onDismiss,
  className
}: ProjectInstructionsNoticeProps): React.ReactElement | null {
  if (!shouldPromptForAgentsMd(state)) {
    return null;
  }

  return (
    <CoopNotice
      tone="info"
      title="Create AGENTS.md"
      message="A short project guide Coop reads on every message."
      onDismiss={onDismiss}
      dismissLabel="Not now"
      className={className}
    >
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="coop-settings-action-btn" onClick={onStartFromTemplate}>
          Create AGENTS.md
        </button>
        <button type="button" className="coop-text-btn" onClick={onAttach}>
          Upload AGENTS.md
        </button>
      </div>
    </CoopNotice>
  );
}

type AgentsMdStatusChipProps = {
  state?: ProjectInstructionsState;
  onCreate?: () => void;
  onOpen?: () => void;
  disabled?: boolean;
};

export function AgentsMdStatusChip({
  state,
  onCreate,
  onOpen,
  disabled
}: AgentsMdStatusChipProps): React.ReactElement | null {
  if (!state || state.status === "disabled") {
    return null;
  }

  const title = agentsMdStatusTitle(state);

  if (agentsMdAttached(state)) {
    return (
      <button
        type="button"
        className="coop-agents-md-chip coop-agents-md-chip--attached coop-agents-md-chip--clickable"
        title={title}
        aria-label="Open AGENTS.md"
        disabled={disabled || !onOpen}
        onClick={onOpen}
      >
        <span className="coop-agents-md-chip-icon" aria-hidden="true">
          ✓
        </span>
        AGENTS.md
      </button>
    );
  }

  return (
    <button
      type="button"
      className="coop-agents-md-chip coop-agents-md-chip--missing"
      title={title}
      aria-label="Create AGENTS.md"
      disabled={disabled || !onCreate}
      onClick={onCreate}
    >
      <span className="coop-agents-md-chip-icon" aria-hidden="true">
        ✕
      </span>
      AGENTS.md
    </button>
  );
}

/** @deprecated Use AgentsMdStatusChip */
export const ProjectInstructionsChip = AgentsMdStatusChip;
