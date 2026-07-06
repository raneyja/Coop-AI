"use client";

import Link from "next/link";
import { Children, isValidElement, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsFigureGrid } from "@/components/DocsFigureGrid";
import { splitDocsContent } from "@/lib/docsFigures";
import {
  docsFigureCaptionClassName,
  docsFigureClassName,
  docsHeadingH2ClassName,
  docsHeadingH3ClassName,
  docsInlineLinkClassName
} from "@/lib/docsStyles";
import { slugifyHeading } from "@/lib/manual.shared";

type DocsMarkdownProps = {
  content: string;
};

function isEmOnlyParagraph(children: React.ReactNode): boolean {
  const items = Children.toArray(children);
  if (items.length !== 1 || !isValidElement(items[0])) {
    return false;
  }

  return items[0].type === "em";
}

function DocsMarkdownBlock({ content }: { content: string }) {
  const afterImageRef = useRef(false);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => {
          afterImageRef.current = false;
          const text = String(children);
          return (
            <h2 id={slugifyHeading(text)} className={docsHeadingH2ClassName}>
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
          afterImageRef.current = false;
          const text = String(children);
          return (
            <h3 id={slugifyHeading(text)} className={docsHeadingH3ClassName}>
              {children}
            </h3>
          );
        },
        a: ({ href, children }) => {
          if (href?.startsWith("/")) {
            return (
              <Link href={href} className={docsInlineLinkClassName}>
                {children}
              </Link>
            );
          }

          return (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className={docsInlineLinkClassName}
            >
              {children}
            </a>
          );
        },
        img: ({ src, alt }) => {
          if (!src || typeof src !== "string") {
            return null;
          }

          afterImageRef.current = true;

          return (
            <span className={docsFigureClassName}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt ?? ""} className="h-auto w-full" loading="lazy" />
            </span>
          );
        },
        p: ({ children }) => {
          if (afterImageRef.current && isEmOnlyParagraph(children)) {
            afterImageRef.current = false;
            return <p className={docsFigureCaptionClassName}>{children}</p>;
          }

          afterImageRef.current = false;
          return <p>{children}</p>;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function DocsMarkdown({ content }: DocsMarkdownProps) {
  const segments = useMemo(() => splitDocsContent(content), [content]);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "figures") {
          return <DocsFigureGrid key={`figures-${index}`} items={segment.items} />;
        }

        return <DocsMarkdownBlock key={`md-${index}`} content={segment.content} />;
      })}
    </>
  );
}
