import {
  docsFigureGridCaptionClassName,
  docsFigureGridClassName,
  docsFigureGridCompactClassName,
  docsFigureSingleClassName,
  docsFigureSingleCompactClassName,
  docsFigureSingleMediumClassName,
  docsFigureSingleSmallClassName,
  docsFigureTileClassName
} from "@/lib/docsStyles";
import type { DocsFigureItem, DocsFigureSize } from "@/lib/docsFigures";

type DocsFigureGridProps = {
  items: DocsFigureItem[];
  compact?: boolean;
  size?: DocsFigureSize;
};

export function DocsFigureGrid({ items, compact, size }: DocsFigureGridProps) {
  if (items.length === 0) {
    return null;
  }

  const single = items.length === 1;
  const figureClassName = single
    ? size === "sm"
      ? docsFigureSingleSmallClassName
      : size === "md"
        ? docsFigureSingleMediumClassName
        : compact
          ? docsFigureSingleCompactClassName
          : docsFigureSingleClassName
    : compact
      ? docsFigureGridCompactClassName
      : docsFigureGridClassName;

  return (
    <figure className={figureClassName}>
      {items.map((item) => (
        <div key={item.src} className={single ? undefined : "min-w-0"}>
          <span className={docsFigureTileClassName}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.src} alt={item.alt} className="h-auto w-full" loading="lazy" />
          </span>
          {item.caption ? (
            <figcaption className={docsFigureGridCaptionClassName}>{item.caption}</figcaption>
          ) : null}
        </div>
      ))}
    </figure>
  );
}
