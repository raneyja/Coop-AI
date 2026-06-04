import React, { useEffect, useRef, useState } from "react";

const STORED_SECRET_MASK = "••••••••••••";

type ConfiguredSecretInputProps = {
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function ConfiguredSecretInput({
  configured,
  value,
  onChange,
  placeholder,
  className
}: ConfiguredSecretInputProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const previousValueRef = useRef(value);
  const showingMask = configured && !editing && value.length === 0;

  useEffect(() => {
    if (previousValueRef.current.length > 0 && value.length === 0 && configured) {
      setEditing(false);
    }
    previousValueRef.current = value;
  }, [configured, value]);

  useEffect(() => {
    if (!configured) {
      setEditing(false);
    }
  }, [configured]);

  return (
    <input
      type="password"
      value={showingMask ? STORED_SECRET_MASK : value}
      placeholder={showingMask ? undefined : placeholder}
      readOnly={showingMask}
      className={className}
      onFocus={() => {
        if (showingMask) {
          setEditing(true);
        }
      }}
      onBlur={() => {
        if (value.length === 0 && configured) {
          setEditing(false);
        }
      }}
      onChange={(event) => {
        if (!showingMask) {
          onChange(event.target.value);
        }
      }}
    />
  );
}
