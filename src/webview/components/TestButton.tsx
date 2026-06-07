import React from "react";

export type SettingsTestKey =
  | "connection"
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "jira"
  | "teams"
  | "confluence"
  | "notion"
  | "google-docs";

type TestButtonProps = {
  testKey: SettingsTestKey;
  label: string;
  pendingTest: SettingsTestKey | null;
  testResult: { key: SettingsTestKey; ok: boolean } | null;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
};

function LoadingSpinner({ className = "h-3.5 w-3.5" }: { className?: string }): React.ReactElement {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

function SuccessIcon({ className = "h-3.5 w-3.5" }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function ErrorIcon({ className = "h-3.5 w-3.5" }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" d="M5 5l6 6M11 5l-6 6" />
    </svg>
  );
}

export function TestButton({
  testKey,
  label,
  pendingTest,
  testResult,
  onClick,
  className = "coop-settings-action-btn",
  disabled = false
}: TestButtonProps): React.ReactElement {
  const loading = pendingTest === testKey;
  const flash = testResult?.key === testKey ? testResult.ok : null;
  const isDisabled = disabled || loading || flash !== null;

  let content: React.ReactNode = label;
  let stateClass = "";
  let ariaLabel = label;

  if (loading) {
    content = <LoadingSpinner />;
    ariaLabel = `Testing ${label.replace(/^Test /i, "")}`;
  } else if (flash === true) {
    content = <SuccessIcon />;
    stateClass = "coop-test-btn--success";
    ariaLabel = `${label} succeeded`;
  } else if (flash === false) {
    content = <ErrorIcon />;
    stateClass = "coop-test-btn--error";
    ariaLabel = `${label} failed`;
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center ${className}${loading || flash !== null ? " min-w-[5.5rem] justify-center" : ""} ${stateClass}`}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}
