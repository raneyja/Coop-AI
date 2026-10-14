import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  titleClassName?: string;
  secondaryTitle?: string;
  description?: string;
  /** Less padding below the header (e.g. when content follows immediately) */
  tight?: boolean;
};

export function PageHeader({ eyebrow, title, titleClassName, secondaryTitle, description, tight = false }: PageHeaderProps) {
  return (
    <div
      className={`mx-auto max-w-5xl px-6 text-center ${tight ? "pt-14 pb-4 md:pt-20 md:pb-5" : "pt-16 pb-12 md:pt-24"}`}
    >
      {eyebrow && (
        <p className="coop-section-label">{eyebrow.toLowerCase()}</p>
      )}
      <h1
        className={`site-title site-page-title mt-3 font-medium text-gray-900${titleClassName ? ` ${titleClassName}` : ""}`}
      >
        {title}{secondaryTitle && <> <span className="site-title-secondary">{secondaryTitle}</span></>}
      </h1>
      {description && (
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-coop-muted">{description}</p>
      )}
    </div>
  );
}
