type SectionHeadingProps = {
  /** Renders as // label in mono */
  label?: string;
  title: string;
  secondaryTitle?: string;
  description?: string;
  className?: string;
  tone?: "light" | "dark";
};

export function SectionHeading({
  label,
  title,
  secondaryTitle,
  description,
  className = "",
  tone = "light"
}: SectionHeadingProps) {
  const dark = tone === "dark";
  return (
    <div className={className}>
      {label ? (
        <p className={dark ? "font-mono text-xs text-white/35" : "coop-section-label"}>
          {dark ? `// ${label}` : label}
        </p>
      ) : null}
      <h2
        className={`site-title${dark ? " site-title-dark" : ""} text-2xl font-normal ${dark ? "text-white" : "text-gray-900"}${label ? " mt-2" : ""}`}
      >
        {title}{secondaryTitle && <> <span className="site-title-secondary">{secondaryTitle}</span></>}
      </h2>
      {description ? (
        <p
          className={`mt-3 max-w-2xl text-sm leading-relaxed ${dark ? "text-white/50" : "text-coop-muted"}`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
