import React from "react";
import { IntegrationResultActions } from "./components/IntegrationResultCard";

type EvidenceCardActionsProps = {
  children: React.ReactNode;
};

export function EvidenceCardActions({ children }: EvidenceCardActionsProps): React.ReactElement {
  return <IntegrationResultActions>{children}</IntegrationResultActions>;
}

type ActionButtonProps = {
  label: string;
  onClick: () => void;
};

export function EvidenceActionButton({ label, onClick }: ActionButtonProps): React.ReactElement {
  return (
    <button type="button" className="coop-settings-action-btn" onClick={onClick}>
      {label}
    </button>
  );
}
