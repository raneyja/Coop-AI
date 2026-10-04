"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionHeading } from "@/components/SectionHeading";
import { siteConfig } from "@/lib/site.config";

type Quote = (typeof siteConfig.quotes)[number];
type Tone = "light" | "dark";

/** Soft emphasis on concrete outcomes — keeps the rest of the quote calm. */
function emphasizeProof(text: string, tone: Tone) {
  const pattern =
    /(\d+%\+?|\d+\+?\s*hours?(?:\s+each\s+week)?|\d+\+?\s*hours?\s+a\s+week|weeks?|minutes?|cut that in half|50% drop)/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <span key={key++} className={`font-semibold ${tone === "dark" ? "text-white" : "text-gray-900"}`}>
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length > 0 ? parts : text;
}

function QuoteCard({
  quote,
  visible,
  delayMs,
  tone
}: {
  quote: Quote;
  visible: boolean;
  delayMs: number;
  tone: Tone;
}) {
  const dark = tone === "dark";
  return (
    <figure
      className={`relative flex h-full flex-col rounded-2xl border p-5 transition-all duration-500 ease-out motion-reduce:transition-none md:p-6 ${
        dark ? "border-white/10 bg-white/[0.03]" : "border-coop-border bg-white"
      } ${visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
    >
      <blockquote
        className={`flex-1 text-sm font-medium leading-relaxed md:text-[15px] ${
          dark ? "text-white/70" : "text-gray-800"
        }`}
      >
        {emphasizeProof(quote.text, tone)}
      </blockquote>
      <figcaption
        className={`mt-5 border-t pt-4 ${
          dark ? "border-white/10" : "border-coop-border"
        }`}
      >
        <p className={`text-xs font-medium leading-relaxed ${dark ? "text-white/70" : "text-gray-800"}`}>
          {quote.author}
        </p>
        {"detail" in quote && quote.detail ? (
          <p
            className={`mt-1 font-mono text-xs leading-relaxed ${
              dark ? "text-white/40" : "text-coop-muted"
            }`}
          >
            {quote.detail}
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function Testimonial({ tone = "light" }: { tone?: Tone }) {
  const quotes = siteConfig.quotes;
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const dark = tone === "dark";

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={dark ? "border-y border-white/10 py-20 md:py-24" : "border-y border-coop-border py-20 md:py-24"}
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          tone={tone}
          label="social_proof"
          title="What our customers measure"
          description="Engineering teams using CoopAI on real production repos."
        />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {quotes.map((quote, i) => (
            <QuoteCard
              key={quote.text.slice(0, 40)}
              quote={quote}
              visible={visible}
              delayMs={i * 90}
              tone={tone}
            />
          ))}
        </div>

      </div>
    </section>
  );
}
