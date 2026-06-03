import type { BrandLogoItem } from "./brand-icons";

type LogoStripProps = {
  label: string;
  items: BrandLogoItem[];
  /** Product page: divider below. Home: inline stack only */
  variant?: "section" | "inline";
  className?: string;
  ariaLabel?: string;
};

export function LogoStrip({
  label,
  items,
  variant = "inline",
  className = "",
  ariaLabel
}: LogoStripProps) {
  const sectionStyles =
    variant === "section" ? "mb-10 border-b border-white/5 pb-10" : "";

  return (
    <div className={`${sectionStyles} ${className}`.trim()} aria-label={ariaLabel ?? label}>
      <p className="mb-5 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-white/30">
        {label}
      </p>
      <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 md:gap-x-10">
        {items.map(({ name, Icon, colored }) => (
          <li
            key={name}
            className="flex items-center gap-2 text-white/55 opacity-45 transition-[opacity,color] duration-200 hover:text-white/75 hover:opacity-75"
          >
            <span className={colored ? "opacity-90" : undefined}>
              <Icon
                className={`h-5 w-5 shrink-0 md:h-[22px] md:w-[22px]${colored ? "" : " text-inherit"}`}
              />
            </span>
            <span className="text-xs font-medium tracking-tight text-white/70 md:text-sm">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
