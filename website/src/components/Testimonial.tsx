import { siteConfig } from "@/lib/site.config";

export function Testimonial() {
  return (
    <section className="border-y border-white/5 bg-coop-surface/30 py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <blockquote className="text-xl font-medium leading-relaxed text-white md:text-2xl">
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
