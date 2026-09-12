import React, { useEffect, useRef } from "react";
import { buildCodeSnippetPreview } from "../../context/evidenceBodyPreview";
import { ChatActionLink } from "./ChatActionLink";
import { ChatProse } from "./ChatProse";
import { useChatLinks } from "./ChatLinkContext";
import { useCitationNavigation } from "./CitationNavigationContext";
import { IntegrationSourceHeading, IntegrationSourceIcon, type IntegrationSourceId } from "./IntegrationSourceBrand";
import {
  useEvidenceCardExpand,
  useEvidenceConnectionExpand
} from "../evidenceConnectionExpandContext";

type IntegrationResultCardProps = {
  title: string;
  meta?: React.ReactNode;
  status?: string;
  statusTone?: "default" | "partial" | "minimal" | "warning";
  onDismiss?: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  scrollable?: boolean;
  className?: string;
  /** Sources cards: collapsed to the title until the user clicks. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  titleProviders?: IntegrationSourceId[];
};

export function IntegrationResultStack({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="coop-result-stack">{children}</div>;
}

export function IntegrationResultCard({
  title,
  meta,
  status,
  statusTone = "default",
  onDismiss,
  ariaLabel,
  children,
  scrollable = false,
  className,
  expanded = true,
  onToggleExpand,
  titleProviders
}: IntegrationResultCardProps): React.ReactElement {
  const collapsible = Boolean(onToggleExpand);
  const collapsed = collapsible && !expanded;
  const cardClassName = [
    "coop-result-card",
    collapsed ? "coop-result-card--collapsed" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  const titleRow = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {collapsible ? (
        <span className="coop-result-collapsible-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      ) : null}
      {titleProviders?.map((provider) => (
        <IntegrationSourceIcon key={provider} provider={provider} size={16} />
      ))}
      <span className="coop-result-title">{title}</span>
      {status && !collapsed ? (
        <span className={`coop-result-status coop-result-status--${statusTone}`}>{status}</span>
      ) : null}
    </div>
  );

  return (
    <section className={cardClassName} aria-label={ariaLabel}>
      <header className={`coop-result-header${collapsible ? " coop-result-header--collapsible" : ""}`}>
        {collapsible ? (
          <button
            type="button"
            className="coop-result-header-toggle"
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              {titleRow}
              {meta && expanded ? <span className="coop-result-meta">{meta}</span> : null}
            </span>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            {titleRow}
            {meta ? <p className="coop-result-meta">{meta}</p> : null}
          </div>
        )}
        {onDismiss ? (
          <button type="button" className="coop-text-btn shrink-0" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </header>
      <div
        className={scrollable ? "coop-result-body" : "coop-result-content"}
        hidden={collapsed}
        aria-hidden={collapsed}
      >
        {children}
      </div>
    </section>
  );
}

export function IntegrationResultSection({
  label,
  children,
  className
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={`coop-result-section${className ? ` ${className}` : ""}`}>
      {label ? <p className="coop-result-section-label">{label}</p> : null}
      {children}
    </section>
  );
}

export function IntegrationResultRow({
  label,
  children,
  action
}: {
  label?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="coop-result-row">
      <div className="min-w-0 flex-1">
        {label ? <p className="coop-result-row-label">{label}</p> : null}
        <div className="coop-result-row-body">{children}</div>
      </div>
      {action ? <div className="coop-result-row-action">{action}</div> : null}
    </div>
  );
}

/** One search hit with an Open-in-native-app control when a URL exists. */
export function IntegrationNativeOpenRow({
  label,
  preview,
  url,
  openLabel
}: {
  label?: string;
  preview: string;
  url?: string;
  openLabel: string;
}): React.ReactElement {
  const { onOpenLink } = useChatLinks();
  return (
    <IntegrationResultRow
      label={label}
      action={
        url ? (
          <ChatActionLink kind="external" label={openLabel} onClick={() => onOpenLink?.(url)} />
        ) : undefined
      }
    >
      <p className="coop-result-text">{preview}</p>
    </IntegrationResultRow>
  );
}

export function IntegrationResultBadge({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "warning" | "info";
}): React.ReactElement {
  return <span className={`coop-result-badge coop-result-badge--${tone}`}>{children}</span>;
}

export function IntegrationResultCollapsible({
  title,
  provider,
  destination,
  subtitle,
  sourceLabel,
  sectionDomId,
  stalenessLabel,
  open,
  onToggle,
  link,
  linkLabel,
  hideHeader = false,
  /** When false, omit from the collapsed source-inventory preview (empty/error stubs). */
  inventory = true,
  children
}: {
  title: string;
  provider?: IntegrationSourceId;
  destination?: string;
  subtitle?: string;
  sourceLabel?: string;
  sectionDomId?: string;
  stalenessLabel?: string;
  open: boolean;
  onToggle: () => void;
  link?: string;
  linkLabel?: string;
  hideHeader?: boolean;
  inventory?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { onOpenLink } = useChatLinks();
  const { registerEvidenceAnchor, scrollToCitation } = useCitationNavigation();
  const ensureConnectionExpanded = useEvidenceConnectionExpand();
  const expandCard = useEvidenceCardExpand()?.expand;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const useBrandedHeader = Boolean(provider && destination);

  useEffect(() => {
    if (!sectionDomId) {
      return;
    }
    registerEvidenceAnchor(sectionDomId, rootRef.current, () => {
      expandCard?.();
      ensureConnectionExpanded?.();
      if (!hideHeader && !open) {
        onToggle();
      }
    });
    return () => registerEvidenceAnchor(sectionDomId, null);
  }, [
    sectionDomId,
    open,
    onToggle,
    registerEvidenceAnchor,
    ensureConnectionExpanded,
    expandCard,
    hideHeader
  ]);

  const showBody = hideHeader || open;

  return (
    <div
      className={`coop-result-collapsible${hideHeader ? " coop-result-collapsible--flat" : ""}`}
      id={sectionDomId}
      ref={rootRef}
    >
      {hideHeader ? null : (
        <div className="coop-result-collapsible-header">
          <button
            type="button"
            className={`coop-result-collapsible-toggle${useBrandedHeader ? " coop-result-collapsible-toggle--branded" : ""}`}
            onClick={onToggle}
            aria-expanded={open}
          >
            <span className="coop-result-collapsible-chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            {useBrandedHeader ? (
              <IntegrationSourceHeading
                provider={provider!}
                destination={destination!}
                subtitle={open ? undefined : subtitle}
              />
            ) : (
              <span className="coop-result-collapsible-title">{title}</span>
            )}
            {sourceLabel ? (
              <button
                type="button"
                className="coop-result-source-cite coop-result-source-cite--link"
                onClick={(event) => {
                  event.stopPropagation();
                  scrollToCitation(sectionDomId ?? sourceLabel);
                }}
              >
                {sourceLabel}
              </button>
            ) : null}
            {stalenessLabel ? (
              <span className="coop-result-staleness">{stalenessLabel}</span>
            ) : null}
          </button>
          {link ? (
            <ChatActionLink
              kind="external"
              label={linkLabel ?? "Open"}
              className="coop-result-collapsible-link shrink-0"
              onClick={() => onOpenLink?.(link)}
            />
          ) : null}
        </div>
      )}
      {showBody ? <div className="coop-result-collapsible-body">{children}</div> : null}
    </div>
  );
}
IntegrationResultCollapsible.displayName = "IntegrationResultCollapsible";

export function IntegrationResultCode({
  children,
  /** When false (default), string bodies are hard-capped — never dump a full file. */
  allowFull = false
}: {
  children: React.ReactNode;
  allowFull?: boolean;
}): React.ReactElement {
  if (!allowFull && typeof children === "string") {
    const { preview, truncated } = buildCodeSnippetPreview(children);
    return (
      <div className="space-y-1">
        <pre className="coop-result-code">{preview}</pre>
        {truncated ? (
          <p className="coop-result-text coop-result-text--muted text-[10px]">
            Truncated preview — open the file for the full source.
          </p>
        ) : null}
      </div>
    );
  }
  return <pre className="coop-result-code">{children}</pre>;
}

export function IntegrationResultNested({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return <div className={`coop-result-nested${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function IntegrationResultText({
  children,
  muted,
  className
}: {
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
}): React.ReactElement {
  const textClassName = [
    muted ? "coop-result-text coop-result-text--muted" : "coop-result-text",
    className
  ]
    .filter(Boolean)
    .join(" ");
  if (typeof children === "string") {
    return (
      <ChatProse
        content={children}
        className={textClassName}
      />
    );
  }

  return <p className={textClassName}>{children}</p>;
}

export function IntegrationResultActions({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="coop-result-actions">{children}</div>;
}
