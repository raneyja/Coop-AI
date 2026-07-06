import {
  docsFigureGridCaptionClassName,
  docsFigureGridClassName,
  docsFigureTileClassName
} from "@/lib/docsStyles";
import type { DocsFigureItem } from "@/lib/docsFigures";

type DocsFigureGridProps = {
  items: DocsFigureItem[];
};

export function DocsFigureGrid({ items }: DocsFigureGridProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <figure className={docsFigureGridClassName}>
      {items.map((item) => (
        <div key={item.src} className="min-w-0">
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
