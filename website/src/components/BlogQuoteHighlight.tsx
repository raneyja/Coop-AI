import Link from "next/link";

type BlogQuoteHighlightProps = {
  text: string;
  sourceTitle: string;
  sourceSlug: string;
};

export function BlogQuoteHighlight({ text, sourceTitle, sourceSlug }: BlogQuoteHighlightProps) {
  return (
    <section className="border-y border-coop-border bg-gray-50 py-16 md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <blockquote className="text-2xl font-medium leading-relaxed tracking-tight text-gray-900 md:text-3xl">
          &ldquo;{text}&rdquo;
        </blockquote>
        <p className="mt-6 text-sm text-coop-muted">
          From &ldquo;{sourceTitle}&rdquo;{" "}
          <Link href={`/blog/${sourceSlug}`} className="font-medium text-gray-900 hover:underline">
            Read more →
          </Link>
        </p>
      </div>
    </section>
  );
}
