import React from "react";

export type IntegrationSourceId =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "jira"
  | "teams"
  | "confluence"
  | "notion"
  | "google-docs";

const LABELS: Record<IntegrationSourceId, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  slack: "Slack",
  jira: "Jira",
  teams: "Microsoft Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

const INTEGRATION_SOURCE_IDS = new Set<string>(Object.keys(LABELS));

export function isIntegrationSourceId(value: string): value is IntegrationSourceId {
  return INTEGRATION_SOURCE_IDS.has(value);
}

export function integrationSourceLabel(provider: IntegrationSourceId): string {
  return LABELS[provider];
}

type IconProps = {
  size?: number;
  className?: string;
};

function BrandSvg({
  size = 16,
  className,
  provider,
  children,
  viewBox = "0 0 24 24"
}: IconProps & {
  provider?: IntegrationSourceId;
  children: React.ReactNode;
  viewBox?: string;
}): React.ReactElement {
  const classes = [
    className ?? "coop-source-icon",
    provider ? `coop-source-icon--${provider}` : undefined
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg viewBox={viewBox} width={size} height={size} className={classes} aria-hidden>
      {children}
    </svg>
  );
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
  switch (provider) {
    case "github":
      return (
        <BrandSvg size={size} className={className} provider="github">
          <path
            fill="currentColor"
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.825-.258.825-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </BrandSvg>
      );
    case "gitlab":
      return (
        <BrandSvg size={size} className={className} provider="gitlab">
          <path
            fill="currentColor"
            d="m23.6 9.593-.033-.087L20.34.306a.85.85 0 0 0-.336-.405.872.872 0 0 0-.999.17l-5.302 6.072-.96-2.953a.85.85 0 0 0-1.616 0l-.96 2.953-5.301-6.07a.872.872 0 0 0-1-.17.85.85 0 0 0-.336.406L.433 9.506l-.033.087a.85.85 0 0 0 .305.941l9.255 6.72-.004.01 2.447 7.506a.85.85 0 0 0 1.62.053L12 19.94l4.977 3.174a.85.85 0 0 0 1.62-.053l2.447-7.507-.003-.01 9.257-6.72a.85.85 0 0 0 .302-.94"
          />
        </BrandSvg>
      );
    case "bitbucket":
      return (
        <BrandSvg size={size} className={className} provider="bitbucket">
          <path
            fill="currentColor"
            d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H20.61c.507-.005.938-.373 1.022-.873l3.263-19.81a.768.768 0 0 0-.768-.892H.778zm14.376 15.41h-4.074l-1.607-10.085 1.61 10.085h4.07l1.494-9.633 1.52 9.633h4.074l-3.085-19.61H18.72l-1.52 9.633-1.52-9.633h-3.075l-3.085 19.61h3.075l1.494-9.633 1.494 9.633z"
          />
        </BrandSvg>
      );
    case "slack":
      return (
        <BrandSvg size={size} className={className} provider="slack">
          <path
            fill="currentColor"
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.528 2.528 0 0 1 2.522-2.52h2.52V12.64H2.522A2.528 2.528 0 0 1 0 10.12a2.528 2.528 0 0 1 2.522-2.522h2.52V6.075a2.528 2.528 0 0 1 2.52-2.523A2.528 2.528 0 0 1 7.564 6.075v2.523h2.523V6.075A2.528 2.528 0 0 1 12.607 3.552a2.528 2.528 0 0 1 2.52 2.523v2.523h2.523a2.528 2.528 0 0 1 2.523 2.523 2.528 2.528 0 0 1-2.523 2.522h-2.523v2.525a2.528 2.528 0 0 1-2.52 2.523 2.528 2.528 0 0 1-2.523-2.523v-2.525H7.564z"
          />
        </BrandSvg>
      );
    case "jira":
      return (
        <BrandSvg size={size} className={className} provider="jira">
          <path
            fill="currentColor"
            d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h6.35v2.574A2.715 2.715 0 0 0 14.54 21.87h2.574V11.513zm5.218 0H11.57V0a5.218 5.218 0 0 0 5.215 5.232h2.574v6.35a2.715 2.715 0 0 0 2.574 2.574h2.574V11.513z"
          />
        </BrandSvg>
      );
    case "teams":
      return (
        <BrandSvg size={size} className={className} provider="teams">
          <path
            fill="currentColor"
            d="M20.625 8.227V4.875A2.878 2.878 0 0 0 17.75 2h-6.5A2.878 2.878 0 0 0 8.375 4.875v3.352A3.375 3.375 0 0 0 5 11.625v6.75A2.878 2.878 0 0 0 7.875 21.25h6.75a2.878 2.878 0 0 0 2.875-2.875v-6.75a3.375 3.375 0 0 0-3.375-3.398h-.525zM14.25 4.875v3.352h-4.5V4.875a1.128 1.128 0 0 1 1.125-1.125h2.25a1.128 1.128 0 0 1 1.125 1.125zM17.75 12.375v6.75a1.128 1.128 0 0 1-1.125 1.125h-6.75a1.128 1.128 0 0 1-1.125-1.125v-6.75a1.128 1.128 0 0 1 1.125-1.125h6.75a1.128 1.128 0 0 1 1.125 1.125zM4.125 6.75h-.375a1.128 1.128 0 0 0-1.125 1.125v6.75A2.878 2.878 0 0 0 5.5 17.5h.375a1.128 1.128 0 0 0 1.125-1.125v-6.75A2.878 2.878 0 0 0 4.125 6.75z"
          />
        </BrandSvg>
      );
    case "confluence":
      return (
        <BrandSvg size={size} className={className} provider="confluence">
          <path
            fill="currentColor"
            d="M.872 2.306C.396 2.932 0 3.93 0 5.063v13.874c0 1.132.396 2.13.872 2.757l6.81 5.904c.561.486 1.415.486 1.976 0l6.81-5.904c.476-.627.872-1.625.872-2.757V5.063c0-1.132-.396-2.03-.872-2.657L9.658.299a1.39 1.39 0 0 0-1.976 0L.872 2.306zm4.89 1.168L12 8.193l6.238-4.719L12 12.63 5.762 3.474z"
          />
        </BrandSvg>
      );
    case "notion":
      return (
        <BrandSvg size={size} className={className} provider="notion">
          <path
            fill="currentColor"
            d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.378c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-13.683.887c-.56.047-.747.327-.747.933zm14.337.606c.093.42 0 .56-.28.606l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.466 0-.607-.186-.607-.607V9.01l-1.214-.233c-.513-.093-.7-.28-.607-.653l.047-.187 1.307-.14z"
          />
        </BrandSvg>
      );
    case "google-docs":
      return (
        <BrandSvg size={size} className={className} provider="google-docs">
          <path fill="#4285F4" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <path fill="#A1C2FA" d="M14 2v6h6" />
          <path fill="#fff" d="M8 13h8v1H8zm0 3h8v1H8zm0-6h3v1H8z" />
        </BrandSvg>
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
