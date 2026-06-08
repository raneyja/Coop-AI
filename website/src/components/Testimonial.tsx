import { siteConfig } from "@/lib/site.config";

export function Testimonial() {
  return (
    <section className="border-y border-coop-border bg-coop-surface/30 py-20">
      <div className="mx-auto max-w-3xl px-6">
        <blockquote className="border-l-2 border-coop-index pl-4 text-lg font-medium leading-relaxed text-white md:text-xl">
          &ldquo;{siteConfig.quote.text}&rdquo;
        </blockquote>
        <footer className="mt-6 text-sm text-coop-muted">
          <span className="font-medium text-white">{siteConfig.quote.author}</span>
          {" · "}
          {siteConfig.quote.company}
        </footer>
      </div>
    </section>
  );
}
