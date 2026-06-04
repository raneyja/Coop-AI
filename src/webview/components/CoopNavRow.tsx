import React from "react";

export function CoopNavList({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="coop-nav-list">{children}</div>;
}

type CoopNavRowProps = {
  title: string;
  subtitle: string;
  configured?: boolean;
  trailing?: React.ReactNode;
  onClick: () => void;
};

export function CoopNavRow({
  title,
  subtitle,
  configured,
  trailing,
  onClick
}: CoopNavRowProps): React.ReactElement {
  return (
    <button type="button" className="coop-nav-row" onClick={onClick}>
      <span className="min-w-0 flex-1 text-left">
        <span className="coop-settings-row-title flex items-center gap-1.5">
          {configured !== undefined ? (
            <span
              className={`coop-settings-status-dot shrink-0${
                configured
                  ? " coop-settings-status-dot--connected"
                  : " coop-settings-status-dot--disconnected"
              }`}
              aria-hidden="true"
            />
          ) : null}
          {title}
        </span>
        <span className="coop-settings-row-desc truncate">{subtitle}</span>
      </span>
      {trailing ?? <ChevronIcon />}
    </button>
  );
}

function ChevronIcon(): React.ReactElement {
  return (
    <svg
      className="coop-nav-chevron shrink-0"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.027 3.749l5.025 4.996-5.025 4.996a.75.75 0 11-1.054-1.066L9.473 8.745 4.973 4.815a.75.75 0 111.054-1.066z" />
    </svg>
  );
}
