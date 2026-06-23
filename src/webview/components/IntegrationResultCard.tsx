import React, { useEffect, useRef } from "react";
import { ChatActionLink } from "./ChatActionLink";
import { ChatProse } from "./ChatProse";
import { useChatLinks } from "./ChatLinkContext";
import { useCitationNavigation } from "./CitationNavigationContext";
import type { IntegrationSourceId } from "./IntegrationSourceBrand";
import { IntegrationSourceHeading } from "./IntegrationSourceBrand";
import { useEvidenceConnectionExpand } from "../evidenceConnectionExpandContext";

type IntegrationResultCardProps = {
  title: string;
  meta?: React.ReactNode;
  status?: string;
  statusTone?: "default" | "partial" | "minimal" | "warning";
  onDismiss?: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  scrollable?: boolean;
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
  scrollable = false
}: IntegrationResultCardProps): React.ReactElement {
  return (
    <section className="coop-result-card" aria-label={ariaLabel}>
      <header className="coop-result-header">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="coop-result-title">{title}</p>
            {status ? (
              <span className={`coop-result-status coop-result-status--${statusTone}`}>{status}</span>
            ) : null}
          </div>
          {meta ? <p className="coop-result-meta">{meta}</p> : null}
        </div>
        {onDismiss ? (
          <button type="button" className="coop-text-btn shrink-0" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </header>
      <div className={scrollable ? "coop-result-body" : "coop-result-content"}>{children}</div>
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
  children: React.ReactNode;
}): React.ReactElement {
  const { onOpenLink } = useChatLinks();
  const { registerEvidenceAnchor, scrollToCitation } = useCitationNavigation();
  const ensureConnectionExpanded = useEvidenceConnectionExpand();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const useBrandedHeader = Boolean(provider && destination);

  useEffect(() => {
    if (!sectionDomId) {
      return;
    }
    registerEvidenceAnchor(sectionDomId, rootRef.current, () => {
      ensureConnectionExpanded?.();
      if (!hideHeader && !open) {
        onToggle();
      }
    });
    return () => registerEvidenceAnchor(sectionDomId, null);
  }, [sectionDomId, open, onToggle, registerEvidenceAnchor, ensureConnectionExpanded, hideHeader]);

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

export function IntegrationResultCode({ children }: { children: React.ReactNode }): React.ReactElement {
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
  muted
}: {
  children: React.ReactNode;
  muted?: boolean;
}): React.ReactElement {
  if (typeof children === "string") {
    return (
      <ChatProse
        content={children}
        className={muted ? "coop-result-text coop-result-text--muted" : "coop-result-text"}
      />
    );
  }

  return <p className={muted ? "coop-result-text coop-result-text--muted" : "coop-result-text"}>{children}</p>;
}

export function IntegrationResultActions({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="coop-result-actions">{children}</div>;
}
