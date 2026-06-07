import React from "react";
import { ChatProse } from "./ChatProse";

type IntegrationResultCardProps = {
  title: string;
  meta?: string;
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
  open,
  onToggle,
  link,
  linkLabel,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  link?: string;
  linkLabel?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="coop-result-collapsible">
      <div className="coop-result-collapsible-header">
        <button
          type="button"
          className="coop-result-collapsible-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="coop-result-collapsible-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="truncate">{title}</span>
        </button>
        {link ? (
          <a href={link} className="coop-text-btn shrink-0 text-[10px]" target="_blank" rel="noreferrer">
            {linkLabel ?? "Open"}
          </a>
        ) : null}
      </div>
      {open ? <div className="coop-result-collapsible-body">{children}</div> : null}
    </div>
  );
}

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
