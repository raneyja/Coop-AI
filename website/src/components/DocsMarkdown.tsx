import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  docsHeadingH2ClassName,
  docsHeadingH3ClassName,
  docsInlineLinkClassName
} from "@/lib/docsStyles";
import { slugifyHeading } from "@/lib/manual.shared";

type DocsMarkdownProps = {
  content: string;
};

export function DocsMarkdown({ content }: DocsMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => {
          const text = String(children);
          return (
            <h2 id={slugifyHeading(text)} className={docsHeadingH2ClassName}>
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
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

          return (
            <span className="not-prose my-10 block border border-coop-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt ?? ""} className="h-auto w-full" loading="lazy" />
            </span>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
