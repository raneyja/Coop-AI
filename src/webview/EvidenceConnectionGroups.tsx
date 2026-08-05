import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IntegrationSourceIcon,
  IntegrationSourceHeading,
  integrationSourceLabel,
  isIntegrationSourceId,
  type IntegrationSourceId
} from "./components/IntegrationSourceBrand";
import { useCitationNavigation } from "./components/CitationNavigationContext";
import { EvidenceConnectionExpandContext } from "./evidenceConnectionExpandContext";
import {
  extractSourceInventoryBriefs,
  renderConnectionBody,
  resolveConnectionBrief,
  type EvidenceConnectionBrief
} from "./evidenceConnectionBriefs";

/** Connection keys for Source details grouping — one subheading per integration. */
export type EvidenceConnectionKey = IntegrationSourceId | "workspace";

const WORKSPACE_LABEL = "Workspace";

function connectionLabel(connection: EvidenceConnectionKey): string {
  if (connection === "workspace") {
    return WORKSPACE_LABEL;
  }
  return integrationSourceLabel(connection);
}

function hasVisibleContent(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => child != null);
}

export function EvidenceConnectionStack({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="coop-result-connection-stack">{children}</div>;
}

/** Groups source-detail sections under a collapsible connection row (GitHub, Slack, Jira, …). */
export function EvidenceConnectionGroup({
  connection,
  label,
  briefSummary,
  children
}: {
  connection: EvidenceConnectionKey;
  label?: string;
  /** Primary line shown when collapsed — defaults to the first nested source section. */
  briefSummary?: EvidenceConnectionBrief;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (!hasVisibleContent(children)) {
    return null;
  }

  return (
    <EvidenceConnectionGroupInner connection={connection} label={label} briefSummary={briefSummary}>
      {children}
    </EvidenceConnectionGroupInner>
  );
}

function EvidenceConnectionGroupInner({
  connection,
  label,
  briefSummary,
  children
}: {
  connection: EvidenceConnectionKey;
  label?: string;
  briefSummary?: EvidenceConnectionBrief;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | undefined>();
  const rootRef = useRef<HTMLElement | null>(null);
  const { scrollToEvidence } = useCitationNavigation();

  const heading = label ?? connectionLabel(connection);
  const brief = useMemo(
    () => resolveConnectionBrief(briefSummary, children),
    [briefSummary, children]
  );
  const inventory = useMemo(() => extractSourceInventoryBriefs(children), [children]);
  const body = useMemo(() => renderConnectionBody(children), [children]);
  const showInventory = !open && inventory.length > 0;
  const showLegacyBrief = !open && inventory.length === 0 && Boolean(brief);

  const ensureOpen = () => {
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !pendingFocusId) {
      return;
    }
    const focusId = pendingFocusId;
    setPendingFocusId(undefined);
    const timer = window.setTimeout(() => {
      scrollToEvidence(focusId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, pendingFocusId, scrollToEvidence]);

  const openAndFocus = (sectionDomId?: string) => {
    if (sectionDomId) {
      setPendingFocusId(sectionDomId);
    }
    setOpen(true);
  };

  return (
    <EvidenceConnectionExpandContext.Provider value={ensureOpen}>
      <section
        ref={rootRef}
        className={`coop-result-connection-group${open ? " coop-result-connection-group--expanded" : " coop-result-connection-group--collapsed"}`}
        aria-label={`${heading} sources`}
      >
        <button
          type="button"
          className="coop-result-connection-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="coop-result-collapsible-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          {isIntegrationSourceId(connection) ? (
            <IntegrationSourceIcon provider={connection} size={16} />
          ) : (
            <WorkspaceIcon size={16} />
          )}
          <span className="coop-result-connection-heading-label">{heading}</span>
          {showInventory && inventory.length > 1 ? (
            <>
              <span className="coop-result-connection-brief-sep" aria-hidden="true">
                ·
              </span>
              <span className="coop-result-connection-brief-title">
                {inventory.length} sources
              </span>
            </>
          ) : null}
          {showLegacyBrief && brief ? (
            <>
              <span className="coop-result-connection-brief-sep" aria-hidden="true">
                -
              </span>
              <span className="coop-result-connection-brief-title">{brief.title}</span>
              {brief.sourceLabel ? (
                <>
                  <span className="coop-result-connection-brief-sep" aria-hidden="true">
                    -
                  </span>
                  <span className="coop-result-source-cite">{brief.sourceLabel}</span>
                </>
              ) : null}
            </>
          ) : null}
        </button>

        {showInventory ? (
          <ConnectionSourceInventory
            connection={connection}
            items={inventory}
            onSelect={openAndFocus}
          />
        ) : null}

        {open ? <div className="coop-result-connection-body">{body}</div> : null}
      </section>
    </EvidenceConnectionExpandContext.Provider>
  );
}

function ConnectionSourceInventory({
  connection,
  items,
  onSelect
}: {
  connection: EvidenceConnectionKey;
  items: EvidenceConnectionBrief[];
  onSelect: (sectionDomId?: string) => void;
}): React.ReactElement {
  return (
    <div
      className="coop-result-connection-inventory"
      role="list"
      aria-label="Source evidence preview"
    >
      {items.map((item, index) => {
        const provider =
          item.provider ?? (isIntegrationSourceId(connection) ? connection : undefined);
        const destination = item.destination ?? item.title;
        const key = item.sectionDomId ?? `${item.title}-${item.sourceLabel ?? index}`;

        return (
          <button
            key={key}
            type="button"
            role="listitem"
            className="coop-result-connection-inventory-item"
            onClick={() => onSelect(item.sectionDomId)}
          >
            {provider ? (
              <IntegrationSourceHeading
                provider={provider}
                destination={destination}
                subtitle={item.subtitle}
              />
            ) : (
              <div className="coop-source-heading min-w-0 flex-1 text-left">
                <div className="coop-source-heading-row">
                  <span className="coop-source-heading-destination">{item.title}</span>
                </div>
                {item.subtitle ? (
                  <p className="coop-source-heading-subtitle">{item.subtitle}</p>
                ) : null}
              </div>
            )}
            {item.sourceLabel ? (
              <span className="coop-result-source-cite">{item.sourceLabel}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Synthesized / cross-source detail (risk flags, escalation, warnings) — not tied to one integration. */
export function EvidenceDerivedGroup({
  title = "Insights",
  children
}: {
  title?: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (!hasVisibleContent(children)) {
    return null;
  }

  return <EvidenceDerivedGroupInner title={title}>{children}</EvidenceDerivedGroupInner>;
}

function EvidenceDerivedGroupInner({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <section
      className={`coop-result-connection-group coop-result-derived-group${open ? " coop-result-connection-group--expanded" : " coop-result-connection-group--collapsed"}`}
      aria-label={title}
    >
      <button
        type="button"
        className="coop-result-connection-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="coop-result-collapsible-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="coop-result-derived-heading">{title}</span>
      </button>
      {open ? <div className="coop-result-connection-body">{children}</div> : null}
    </section>
  );
}

function WorkspaceIcon({ size }: { size: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="coop-source-icon" aria-hidden>
      <path fill="currentColor" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
    </svg>
  );
}
