import React, { useEffect, useRef, useState } from "react";

const STORED_SECRET_MASK = "••••••••••••";

type ConfiguredSecretInputProps = {
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  /** When set, focus on a stored secret requests the real value from the extension host. */
  onReveal?: () => void;
  /** Called on blur while editing a revealed value (not while showing the mask). */
  onBlurCommit?: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function ConfiguredSecretInput({
  configured,
  value,
  onChange,
  onReveal,
  onBlurCommit,
  placeholder,
  className
}: ConfiguredSecretInputProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [legacyEditing, setLegacyEditing] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [visible, setVisible] = useState(false);
  const showingMask = configured && value.length === 0 && !legacyEditing;
  const canToggleVisibility = !showingMask || Boolean(onReveal);

  useEffect(() => {
    if (!configured) {
      setLegacyEditing(false);
      setRevealPending(false);
      setVisible(false);
    }
  }, [configured]);

  useEffect(() => {
    if (!revealPending || value.length === 0) {
      return;
    }
    setRevealPending(false);
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [revealPending, value]);

  const requestReveal = (showPlaintext: boolean) => {
    if (showingMask && onReveal) {
      if (showPlaintext) {
        setVisible(true);
      }
      setRevealPending(true);
      onReveal();
      return true;
    }
    if (showingMask && !onReveal) {
      setLegacyEditing(true);
      if (showPlaintext) {
        setVisible(true);
      }
      return true;
    }
    return false;
  };

  const toggleVisibility = () => {
    if (showingMask) {
      requestReveal(true);
      return;
    }
    setVisible((current) => !current);
  };

  return (
    <div className="coop-secret-field">
      <input
        ref={inputRef}
        type={visible && !showingMask ? "text" : "password"}
        value={showingMask ? STORED_SECRET_MASK : value}
        placeholder={showingMask ? undefined : placeholder}
        readOnly={showingMask}
        className={`coop-settings-field coop-secret-field__input${className ? ` ${className}` : ""}`}
        onFocus={() => {
          if (!showingMask) {
            return;
          }
          requestReveal(false);
        }}
        onBlur={() => {
          if (revealPending) {
            setRevealPending(false);
          }
          if (legacyEditing && value.length === 0) {
            setLegacyEditing(false);
          }
          setVisible(false);
          if (!showingMask) {
            onBlurCommit?.(value);
          }
        }}
        onChange={(event) => {
          if (!showingMask) {
            onChange(event.target.value);
          }
        }}
      />
      {canToggleVisibility ? (
        <button
          type="button"
          className="coop-secret-field__toggle coop-icon-btn"
          aria-label={visible && !showingMask ? "Hide secret" : "Show secret"}
          aria-pressed={visible && !showingMask}
          title={visible && !showingMask ? "Hide secret" : "Show secret"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleVisibility}
        >
          {visible && !showingMask ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      ) : null}
    </div>
  );
}

function EyeIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function EyeOffIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.5 10.7A3 3 0 0 0 12 15a3 3 0 0 0 2.3-.7M7.7 7.8C5.6 9.2 4 11.2 3 12c0 0 3.5 7 10 7 1.8 0 3.4-.4 4.8-1.1M14.1 5.2C15.3 5 16.6 5 18 5c6.5 0 10 7 10 7a16.4 16.4 0 0 1-4.1 5.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
