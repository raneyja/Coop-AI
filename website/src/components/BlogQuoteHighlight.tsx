import Link from "next/link";

type BlogQuoteHighlightProps = {
  text: string;
  sourceTitle: string;
  sourceSlug: string;
};

export function BlogQuoteHighlight({ text, sourceTitle, sourceSlug }: BlogQuoteHighlightProps) {
  return (
    <section className="border-y border-coop-border bg-coop-surface/20 py-16 md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <blockquote className="text-2xl font-medium leading-relaxed tracking-tight text-white md:text-3xl">
          &ldquo;{text}&rdquo;
        </blockquote>
        <p className="mt-6 text-sm text-coop-muted">
          From &ldquo;{sourceTitle}&rdquo;{" "}
          <Link href={`/blog/${sourceSlug}`} className="font-medium text-coop-index hover:text-white">
            Read more →
          </Link>
        </p>
      </div>
    </section>
  );
}
