import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type BlogMarkdownProps = {
  content: string;
};

export function BlogMarkdown({ content }: BlogMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const label = String(children);
          const isWaitlistCta = label === "Join the Coop Waitlist";

          if (isWaitlistCta) {
            return (
              <Link
                href={href ?? "/demo?intent=waitlist"}
                className="not-prose mt-6 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-medium text-coop-dark no-underline transition hover:bg-white/90"
              >
                {children}
              </Link>
            );
          }

          if (href?.startsWith("/")) {
            return (
              <Link href={href} className="text-coop-accent no-underline hover:text-white">
                {children}
              </Link>
            );
          }

          return (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="text-coop-accent no-underline hover:text-white"
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
              <Image
                src={src}
                alt={alt ?? ""}
                width={1200}
                height={675}
                sizes="(max-width: 768px) 100vw, 768px"
                className="h-auto w-full"
              />
            </span>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
