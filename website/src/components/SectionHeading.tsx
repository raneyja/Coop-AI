type SectionHeadingProps = {
  /** Renders as // label in mono */
  label?: string;
  title: string;
  description?: string;
  className?: string;
  tone?: "light" | "dark";
};

export function SectionHeading({
  label,
  title,
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
        className={`text-2xl font-semibold ${dark ? "text-white" : "text-gray-900"}${label ? " mt-2" : ""}`}
      >
        {title}
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
