type SectionHeadingProps = {
  /** Renders as // label in mono */
  label?: string;
  title: string;
  description?: string;
  className?: string;
};

export function SectionHeading({ label, title, description, className = "" }: SectionHeadingProps) {
  return (
    <div className={className}>
      {label ? (
        <p className="coop-section-label">
          <span className="text-gray-400">{"// "}</span>
          {label}
        </p>
      ) : null}
      <h2 className={`text-2xl font-semibold text-gray-900${label ? " mt-2" : ""}`}>{title}</h2>
      {description ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-coop-muted">{description}</p>
      ) : null}
    </div>
  );
}
