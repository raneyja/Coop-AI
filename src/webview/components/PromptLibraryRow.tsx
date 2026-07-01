import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptLibraryItem } from "./promptLibraryTypes";

type PromptLibraryRowBaseProps = {
  prompt: PromptLibraryItem;
  pinned: boolean;
  pinnedIndex?: number;
  pinnedCount?: number;
  dragging?: boolean;
  dropTarget?: boolean;
  onSelect?: (prompt: PromptLibraryItem) => void;
  onRun?: (id: string) => void;
  runDisabled?: boolean;
  onTogglePin?: (id: string) => void;
  onEdit?: (prompt: PromptLibraryItem) => void;
  onDelete?: (id: string) => void;
  onDragStart?: (index: number) => void;
  onDragOver?: (index: number) => void;
  onDrop?: (index: number) => void;
  onDragEnd?: () => void;
};

type PromptLibraryRowManageProps = PromptLibraryRowBaseProps & {
  mode: "manage";
};

type PromptLibraryRowPreviewProps = PromptLibraryRowBaseProps & {
  mode: "preview" | "settings";
};

export type PromptLibraryRowProps = PromptLibraryRowManageProps | PromptLibraryRowPreviewProps;

function GripIcon(): React.ReactElement {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="2.5" r="1.2" />
      <circle cx="7.5" cy="2.5" r="1.2" />
      <circle cx="2.5" cy="7" r="1.2" />
      <circle cx="7.5" cy="7" r="1.2" />
      <circle cx="2.5" cy="11.5" r="1.2" />
      <circle cx="7.5" cy="11.5" r="1.2" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

type RowMenuProps = {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  prompt: PromptLibraryItem;
  onEdit?: (prompt: PromptLibraryItem) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

function RowMenu({ anchorRef, prompt, onEdit, onDelete, onClose }: RowMenuProps): React.ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>();

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const updatePosition = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 120;
      const menuHeight = menuRef.current?.offsetHeight ?? 72;
      const margin = 4;
      const spaceBelow = window.innerHeight - anchorRect.bottom;
      const openUpward = spaceBelow < menuHeight + margin && anchorRect.top > menuHeight + margin;

      setMenuStyle({
        position: "fixed",
        left: Math.max(margin, anchorRect.right - menuWidth),
        top: openUpward ? undefined : anchorRect.bottom + margin,
        bottom: openUpward ? window.innerHeight - anchorRect.top + margin : undefined,
        zIndex: 10000
      });
    };

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="coop-prompt-row-menu coop-prompt-row-menu--floating"
      style={menuStyle}
      role="menu"
    >
      {onEdit ? (
        <button
          type="button"
          role="menuitem"
          className="coop-prompt-row-menu-item"
          onClick={() => {
            onEdit(prompt);
            onClose();
          }}
        >
          Edit
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          className="coop-prompt-row-menu-item coop-prompt-row-menu-item--danger"
          onClick={() => {
            onDelete(prompt.id);
            onClose();
          }}
        >
          Delete
        </button>
      ) : null}
    </div>,
    document.body
  );
}

export function PromptLibraryRow(props: PromptLibraryRowProps): React.ReactElement {
  const {
    prompt,
    pinned,
    pinnedIndex,
    dragging,
    dropTarget,
    onSelect,
    onRun,
    runDisabled,
    onTogglePin,
    onEdit,
    onDelete,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
  } = props;

  const isManage = props.mode === "manage";
  const isSettings = props.mode === "settings";
  const isDraggable = pinned && (isManage || isSettings) && pinnedIndex !== undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const rowClassName = [
    "coop-prompt-modal-row",
    pinned ? "coop-prompt-modal-row--pinned" : "",
    dragging ? "coop-prompt-modal-row--dragging" : "",
    dropTarget ? "coop-prompt-modal-row--drop-target" : "",
    menuOpen ? "coop-prompt-modal-row--menu-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const showActions = isManage;

  return (
    <li
      className={rowClassName}
      draggable={isDraggable}
      onDragStart={(event) => {
        if (!isDraggable || pinnedIndex === undefined) {
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(pinnedIndex));
        onDragStart?.(pinnedIndex);
      }}
      onDragOver={(event) => {
        if (!isDraggable || pinnedIndex === undefined) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver?.(pinnedIndex);
      }}
      onDrop={(event) => {
        if (!isDraggable || pinnedIndex === undefined) {
          return;
        }
        event.preventDefault();
        onDrop?.(pinnedIndex);
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      {pinned ? (
        <span
          className={`coop-prompt-modal-grip${isDraggable ? "" : " coop-prompt-modal-grip--static"}`}
          aria-hidden={!isDraggable}
          aria-label={isDraggable ? `Drag to reorder ${prompt.title}` : undefined}
        >
          <GripIcon />
        </span>
      ) : (
        <span className="coop-prompt-modal-grip coop-prompt-modal-grip--spacer" aria-hidden="true" />
      )}

      <button
        type="button"
        className="coop-prompt-modal-row-title"
        onClick={() => onSelect?.(prompt)}
        title={onSelect ? "Edit prompt" : prompt.title}
        disabled={!onSelect}
      >
        {prompt.title}
      </button>

      {showActions ? (
        <div className="coop-prompt-modal-row-actions">
          {onRun ? (
            <button
              type="button"
              className="coop-text-btn"
              disabled={runDisabled}
              aria-label={`Insert ${prompt.title} into composer`}
              onClick={(event) => {
                event.stopPropagation();
                onRun(prompt.id);
              }}
            >
              Use
            </button>
          ) : null}

          {onTogglePin ? (
            <button
              type="button"
              className={`coop-icon-btn coop-prompt-modal-pin-btn${pinned ? " coop-prompt-modal-pin-btn--active" : ""}`}
              aria-label={pinned ? `Unpin ${prompt.title}` : `Pin ${prompt.title}`}
              onClick={() => onTogglePin(prompt.id)}
            >
              <StarIcon filled={pinned} />
            </button>
          ) : null}

          {(onEdit || onDelete) ? (
            <div className="relative">
              <button
                ref={moreButtonRef}
                type="button"
                className="coop-icon-btn coop-prompt-modal-more-btn"
                aria-label={`Actions for ${prompt.title}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreIcon />
              </button>
              {menuOpen ? (
                <RowMenu
                  anchorRef={moreButtonRef}
                  prompt={prompt}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onClose={() => setMenuOpen(false)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
