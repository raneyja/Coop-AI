import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { installExtensionHref } from "@/lib/site.config";

type BlogMarkdownProps = {
  content: string;
};

export function BlogMarkdown({ content }: BlogMarkdownProps) {
  const installHref = installExtensionHref();
  const installExternal = installHref.startsWith("http");

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const label = String(children);
          const isInstallCta = label === "Install extension";

          if (isInstallCta) {
            if (installExternal) {
              return (
                <a
                  href={installHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="not-prose mt-6 inline-flex items-center justify-center rounded bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-900"
                >
                  {children}
                </a>
              );
            }

            return (
              <Link
                href={installHref}
                className="not-prose mt-6 inline-flex items-center justify-center rounded bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-900"
              >
                {children}
              </Link>
            );
          }

          if (href?.startsWith("/")) {
            return (
              <Link href={href} className="text-gray-900 no-underline hover:underline">
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
