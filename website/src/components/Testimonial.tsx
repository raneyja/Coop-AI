import { siteConfig } from "@/lib/site.config";

export function Testimonial() {
  return (
    <section className="border-y border-coop-border bg-gray-50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 md:grid-cols-2">
          {siteConfig.quotes.map((quote) => (
            <figure key={quote.text.slice(0, 40)}>
              <blockquote className="border-l-2 border-gray-900 pl-4 text-lg font-medium leading-relaxed text-gray-900 md:text-xl">
                &ldquo;{quote.text}&rdquo;
              </blockquote>
              <figcaption className="mt-6 text-sm text-coop-muted">
                <span className="font-medium text-gray-900">{quote.author}</span>
                {"company" in quote && quote.company ? (
                  <>
                    {" · "}
                    {quote.company}
                  </>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
