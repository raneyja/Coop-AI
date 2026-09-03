import React, { useEffect, useMemo, useRef, useState } from "react";
import { canUserSelectModels } from "../../config/featureModelAssignments";
import {
  AUTO_MODEL_INSIGHT,
  formatContextWindowLabel,
  isAutoModelSelection,
  listPickerCatalogModels,
  PICKER_PROVIDER_GROUPS,
  type ModelDefinition
} from "../../config/llmModels";
import type { LlmProviderPreference } from "../../chat/types";

export type ModelPickerSelectProps = {
  plan?: "free" | "pro" | "enterprise";
  usageTier?: string | null;
  devMode?: boolean;
  model: string;
  llmProvider: LlmProviderPreference;
  onChange: (next: { model: string; llmProvider: LlmProviderPreference }) => void;
  compact?: boolean;
};

type HoveredInsight =
  | { kind: "auto" }
  | { kind: "model"; entry: ModelDefinition };

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 opacity-70 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function insightCopy(hovered: HoveredInsight): { title: string; summary: string; context?: string } {
  if (hovered.kind === "auto") {
    return {
      title: AUTO_MODEL_INSIGHT.label,
      summary: AUTO_MODEL_INSIGHT.summary,
      context: "Context window varies by job"
    };
  }
  return {
    title: hovered.entry.label,
    summary: hovered.entry.summary,
    context: formatContextWindowLabel(hovered.entry.contextWindowTokens)
  };
}

export function ModelPickerSelect({
  plan,
  usageTier,
  devMode,
  model,
  llmProvider,
  onChange,
  compact
}: ModelPickerSelectProps): React.ReactElement | null {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const catalog = listPickerCatalogModels();
  const selected = catalog.find((entry) => entry.provider === llmProvider && entry.id === model);
  const usingAuto = isAutoModelSelection(model) || !selected;
  const selectedValue = usingAuto ? "auto" : `${llmProvider}:${model}`;
  const triggerLabel = usingAuto
    ? "Auto"
    : selected.pool === "frontier"
      ? `${selected.label} · Frontier`
      : selected.label;
  const defaultHovered = useMemo<HoveredInsight>(
    () => (usingAuto || !selected ? { kind: "auto" } : { kind: "model", entry: selected }),
    [selected, usingAuto]
  );
  const [hovered, setHovered] = useState<HoveredInsight>(defaultHovered);

  useEffect(() => {
    if (open) {
      setHovered(defaultHovered);
    }
  }, [open, defaultHovered]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!canUserSelectModels({ plan, usageTier, devMode })) {
    return null;
  }

  const insight = insightCopy(hovered);
  const pick = (next: { model: string; llmProvider: LlmProviderPreference }) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={compact ? "coop-model-picker coop-model-picker--compact" : "coop-model-picker"}
        aria-label="Model"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="coop-model-picker-label">{triggerLabel}</span>
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <div className="coop-model-picker-menu">
          <div className="coop-model-picker-menu-panel" role="listbox" aria-label="Model">
            <button
              type="button"
              role="option"
              aria-selected={selectedValue === "auto"}
              className={`coop-prompt-menu-row coop-model-picker-root${hovered.kind === "auto" ? " coop-prompt-menu-row--active" : ""}`}
              onMouseEnter={() => setHovered({ kind: "auto" })}
              onClick={() => pick({ model: "auto", llmProvider })}
            >
              <span className="coop-prompt-menu-row-label">Auto</span>
              {selectedValue === "auto" ? <span className="coop-model-picker-check">✓</span> : null}
            </button>
            {PICKER_PROVIDER_GROUPS.map((group) => {
              const models = catalog.filter((entry) => entry.provider === group.provider);
              if (models.length === 0) {
                return null;
              }
              return (
                <div key={group.provider} className="coop-model-picker-group" role="group" aria-label={group.label}>
                  <p className="coop-model-picker-group-label">{group.label}</p>
                  {models.map((entry) => {
                    const value = `${entry.provider}:${entry.id}`;
                    const isSelected = selectedValue === value;
                    const isHovered = hovered.kind === "model" && hovered.entry.id === entry.id;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`coop-prompt-menu-row coop-model-picker-child${isHovered ? " coop-prompt-menu-row--active" : ""}`}
                        onMouseEnter={() => setHovered({ kind: "model", entry })}
                        onClick={() => pick({ model: entry.id, llmProvider: entry.provider })}
                      >
                        <span className="coop-prompt-menu-row-label">{entry.label}</span>
                        {entry.pool === "frontier" ? (
                          <span className="coop-model-picker-pool">Frontier</span>
                        ) : null}
                        {isSelected ? <span className="coop-model-picker-check">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="coop-model-picker-insight">
            <p className="coop-model-picker-insight-title">{insight.title}</p>
            <p className="coop-model-picker-insight-summary">{insight.summary}</p>
            {insight.context ? <p className="coop-model-picker-insight-meta">{insight.context}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
