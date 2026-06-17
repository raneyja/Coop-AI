import React from "react";

export type IntegrationSourceId =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "jira"
  | "teams";

const LABELS: Record<IntegrationSourceId, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  slack: "Slack",
  jira: "Jira",
  teams: "Microsoft Teams"
};

export function integrationSourceLabel(provider: IntegrationSourceId): string {
  return LABELS[provider];
}

export function IntegrationSourceIcon({
  provider,
  size = 16,
  className
}: {
  provider: IntegrationSourceId;
  size?: number;
  className?: string;
}): React.ReactElement {
  const common = {
    width: size,
    height: size,
    className: className ?? "coop-source-icon",
    "aria-hidden": true as const
  };

  switch (provider) {
    case "github":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      );
    case "gitlab":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="m8 16 4.9-4.9H3.1L8 16Zm0-8.2 4.9-4.9H3.1L8 7.8ZM3.1 9.1 8 14l4.9-4.9H3.1Z" />
        </svg>
      );
    case "bitbucket":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="M.78 3.5h6.3l1.02 6.3H1.8L.78 3.5Zm8.34 0H15.2l-1.02 6.3H8.1l1.02-6.3Z" />
        </svg>
      );
    case "slack":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="M3.5 10.1A1.4 1.4 0 1 1 3.5 7.3h1.4V5.9a1.4 1.4 0 1 1 2.8 0v1.4h1.4a1.4 1.4 0 1 1 0 2.8H7.7v1.4a1.4 1.4 0 1 1-2.8 0v-1.4H3.5Zm6.6-3.5a1.4 1.4 0 1 1 0-2.8h1.4V2.4a1.4 1.4 0 1 1 2.8 0v1.4h1.4a1.4 1.4 0 1 1 0 2.8h-1.4v1.4a1.4 1.4 0 1 1-2.8 0V6.6H10.1Z" />
        </svg>
      );
    case "jira":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="M7.2 2.2 2.2 7.2a1.2 1.2 0 0 0 0 1.7l5 5a1.2 1.2 0 0 0 1.7 0l5-5a1.2 1.2 0 0 0 0-1.7l-5-5a1.2 1.2 0 0 0-1.7 0Zm.85 1.7 3.25 3.25-3.25 3.25-3.25-3.25 3.25-3.25Z" />
        </svg>
      );
    case "teams":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...common}>
          <path d="M4.5 3.5A2 2 0 1 1 4.5 7.5 2 2 0 0 1 4.5 3.5Zm7 1A1.5 1.5 0 1 1 11.5 7 1.5 1.5 0 0 1 11.5 4.5ZM2 8.5A2.5 2.5 0 0 0 4.5 11h3A2.5 2.5 0 0 0 10 8.5V8H2v.5Zm6 0A2.5 2.5 0 0 0 10.5 11H14a2 2 0 0 0 2-2v-.5H8v.5Z" />
        </svg>
      );
  }
}

export function IntegrationSourceChip({
  provider,
  detail
}: {
  provider: IntegrationSourceId;
  detail?: string;
}): React.ReactElement {
  return (
    <span className={`coop-source-chip coop-source-chip--${provider}`}>
      <IntegrationSourceIcon provider={provider} size={14} />
      <span className="coop-source-chip-label">{LABELS[provider]}</span>
      {detail ? <span className="coop-source-chip-detail">{detail}</span> : null}
    </span>
  );
}

export function IntegrationSourceHeading({
  provider,
  destination,
  subtitle
}: {
  provider: IntegrationSourceId;
  destination: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="coop-source-heading min-w-0 flex-1 text-left">
      <div className="coop-source-heading-row">
        <IntegrationSourceIcon provider={provider} size={18} />
        <span className="coop-source-heading-provider">{LABELS[provider]}</span>
        <span className="coop-source-heading-sep" aria-hidden="true">
          ·
        </span>
        <span className="coop-source-heading-destination">{destination}</span>
      </div>
      {subtitle ? <p className="coop-source-heading-subtitle">{subtitle}</p> : null}
    </div>
  );
}
