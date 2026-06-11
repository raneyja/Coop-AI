import React from "react";

export function SettingsSection({
  title,
  description,
  children
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section>
      {title ? <h2 className="coop-settings-section-label">{title}</h2> : null}
      {description ? <p className="coop-settings-card-desc px-0.5">{description}</p> : null}
      <div className="coop-settings-card">{children}</div>
    </section>
  );
}

export function SettingsCheckboxRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="coop-settings-checkbox-row">
      <div className="min-w-0 flex-1">
        <div className="coop-settings-row-title">{title}</div>
        {description ? <div className="coop-settings-row-desc">{description}</div> : null}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export { CoopNavList, CoopNavRow } from "../CoopNavRow";
