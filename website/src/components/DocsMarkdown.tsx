import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugifyHeading } from "@/lib/manual.shared";

type DocsMarkdownProps = {
  content: string;
};

function headingClassName(depth: 2 | 3): string {
  const base = "scroll-mt-24 font-semibold tracking-tight text-white";
  return depth === 2 ? `${base} text-2xl mt-16 mb-4 first:mt-0` : `${base} text-lg mt-10 mb-3`;
}

export function DocsMarkdown({ content }: DocsMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => {
          const text = String(children);
          return <h2 id={slugifyHeading(text)} className={headingClassName(2)}>{children}</h2>;
        },
        h3: ({ children }) => {
          const text = String(children);
          return <h3 id={slugifyHeading(text)} className={headingClassName(3)}>{children}</h3>;
        },
        a: ({ href, children }) => {
          if (href?.startsWith("/")) {
            return (
              <Link href={href} className="text-coop-index no-underline hover:text-white">
                {children}
              </Link>
            );
          }

          return (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="text-coop-index no-underline hover:text-white"
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
            <span className="not-prose my-10 block border border-white/10">
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
