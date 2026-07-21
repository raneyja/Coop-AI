import React from "react";

type CoopPanelHeaderProps = {
  title: string;
  titleId?: string;
  titleElement?: "h1" | "h2";
  subtitle?: React.ReactNode;
  backLabel?: string;
  onBack?: () => void;
  onClose: () => void;
  closeAriaLabel?: string;
  variant?: "panel" | "modal";
  /** When true, subtitle wraps instead of truncating (use on modals). */
  wrapSubtitle?: boolean;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
};

export function CoopPanelHeader({
  title,
  titleId,
  titleElement = "h1",
  subtitle,
  backLabel,
  onBack,
  onClose,
  closeAriaLabel = "Close",
  variant = "panel",
  wrapSubtitle = false,
  meta,
  actions
}: CoopPanelHeaderProps): React.ReactElement {
  const TitleTag = titleElement;
  const backAriaLabel = backLabel ?? "Back";
  const iconOnlyBack = Boolean(onBack) && !backLabel;

  return (
    <header
      className={`coop-panel-header${variant === "panel" ? " coop-panel-header--bordered" : ""}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onBack ? (
          <button
            type="button"
            className={`coop-panel-back-btn shrink-0${iconOnlyBack ? " coop-panel-back-btn--icon" : ""}`}
            onClick={onBack}
            aria-label={backAriaLabel}
            title={backAriaLabel}
          >
            <BackIcon />
            {backLabel ? <span>{backLabel}</span> : null}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <TitleTag id={titleId} className="coop-panel-header-title truncate">
              {title}
            </TitleTag>
            {meta}
          </div>
          {subtitle ? (
            wrapSubtitle || typeof subtitle !== "string" ? (
              <div
                className={
                  wrapSubtitle
                    ? "coop-panel-header-subtitle coop-panel-header-subtitle--wrap"
                    : "coop-panel-header-subtitle"
                }
              >
                {subtitle}
              </div>
            ) : (
              <p className="coop-panel-header-subtitle">{subtitle}</p>
            )
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      <button
        type="button"
        className="coop-icon-btn shrink-0"
        onClick={onClose}
        aria-label={closeAriaLabel}
        title={closeAriaLabel}
      >
        <CloseIcon />
      </button>
    </header>
  );
}

function BackIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M10.707 3.293a1 1 0 010 1.414L7.414 8l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
