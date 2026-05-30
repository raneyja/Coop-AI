import React, { useCallback, useState } from "react";

const DEFAULT_MIN_SPIN_MS = 900;

type RefreshButtonProps = {
  onClick: () => void | Promise<void>;
  className?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  minSpinMs?: number;
};

export function RefreshIcon({ className = "h-3.5 w-3.5" }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V6h-3.5" />
    </svg>
  );
}

export function RefreshButton({
  onClick,
  className = "coop-settings-action-btn",
  label = "Refresh",
  ariaLabel,
  disabled = false,
  minSpinMs = DEFAULT_MIN_SPIN_MS
}: RefreshButtonProps): React.ReactElement {
  const [spinning, setSpinning] = useState(false);

  const handleClick = useCallback(async () => {
    if (spinning || disabled) {
      return;
    }
    setSpinning(true);
    const started = Date.now();
    try {
      await Promise.resolve(onClick());
    } finally {
      const wait = Math.max(0, minSpinMs - (Date.now() - started));
      window.setTimeout(() => setSpinning(false), wait);
    }
  }, [disabled, minSpinMs, onClick, spinning]);

  const isDisabled = disabled || spinning;

  return (
    <button
      type="button"
      className={`inline-flex items-center ${className}${spinning ? " min-w-[4.25rem] justify-center" : ""}`}
      onClick={() => void handleClick()}
      disabled={isDisabled}
      aria-busy={spinning}
      aria-label={spinning ? "Refreshing" : ariaLabel ?? label}
    >
      {spinning ? <RefreshIcon className="h-3.5 w-3.5 animate-spin" /> : label}
    </button>
  );
}
