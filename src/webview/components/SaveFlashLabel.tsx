import React from "react";

export type SettingsSaveKey =
  | "apiKey"
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "jira"
  | "teams"
  | "confluence"
  | "notion"
  | "google-docs";

type SaveFlashLabelProps = {
  show: boolean;
};

export function SaveFlashLabel({ show }: SaveFlashLabelProps): React.ReactElement | null {
  if (!show) {
    return null;
  }

  return (
    <span className="coop-settings-save-flash self-center" role="status" aria-live="polite">
      Saved
    </span>
  );
}
