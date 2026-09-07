import type { BrandLogoItem } from "./brand-icons";

type LogoStripProps = {
  label: string;
  items: BrandLogoItem[];
  /** Product page: divider below. Home: inline stack only */
  variant?: "section" | "inline";
  tone?: "light" | "dark";
  className?: string;
  ariaLabel?: string;
};

export function LogoStrip({
  label,
  items,
  variant = "inline",
  tone = "light",
  className = "",
  ariaLabel
}: LogoStripProps) {
  const sectionStyles =
    variant === "section"
      ? tone === "dark"
        ? "mb-10 border-b border-white/10 pb-10"
        : "mb-10 border-b border-coop-border pb-10"
      : "";
  const dark = tone === "dark";

  return (
    <div className={`${sectionStyles} ${className}`.trim()} aria-label={ariaLabel ?? label}>
      <p
        className={`mb-5 text-center font-mono text-xs ${dark ? "text-white/35" : "coop-section-label"}`}
      >
        {dark ? label : label.toLowerCase()}
      </p>
      <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 md:gap-x-10">
        {items.map(({ name, Icon, colored, wide }) => (
          <li
            key={name}
            className={
              dark
                ? "flex items-center gap-2 text-white/40 opacity-80 transition-[opacity,color] duration-200 hover:text-white hover:opacity-100"
                : "flex items-center gap-2 text-gray-400 opacity-70 transition-[opacity,color] duration-200 hover:text-gray-600 hover:opacity-100"
            }
          >
            <span className={colored ? "opacity-90" : undefined}>
              <Icon
                className={`${wide ? "h-5 w-auto md:h-[22px]" : "h-5 w-5 md:h-[22px] md:w-[22px]"} shrink-0${colored ? "" : " text-inherit"}`}
              />
            </span>
            <span
              className={`text-xs font-medium tracking-tight md:text-sm ${
                dark ? "text-white/55" : "text-gray-600"
              }`}
            >
              {name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
