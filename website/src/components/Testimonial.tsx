"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionHeading } from "@/components/SectionHeading";
import { siteConfig } from "@/lib/site.config";

type Quote = (typeof siteConfig.quotes)[number];

/** Soft emphasis on concrete outcomes — keeps the rest of the quote calm. */
function emphasizeProof(text: string) {
  const pattern =
    /(\d+%\+?|\d+\+?\s*hours?(?:\s+each\s+week)?|\d+\+?\s*hours?\s+a\s+week|weeks?|minutes?|cut that in half)/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <span key={key++} className="font-semibold text-gray-900">
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

function QuoteAttribution({ quote, compact = false }: { quote: Quote; compact?: boolean }) {
  const company = "company" in quote ? quote.company : undefined;
  return (
    <figcaption
      className={`border-t border-coop-border ${compact ? "mt-5 pt-4" : "mt-8 pt-5"}`}
    >
      <p className={`font-medium text-gray-900 ${compact ? "text-sm" : "text-base"}`}>
        {quote.author}
      </p>
      {company ? (
        <p className={`mt-0.5 font-mono text-coop-muted ${compact ? "text-xs" : "text-sm"}`}>
          {company}
        </p>
      ) : null}
    </figcaption>
  );
}

function QuoteMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`pointer-events-none select-none font-serif leading-none text-gray-200 ${className}`.trim()}
      aria-hidden
    >
      &ldquo;
    </span>
  );
}

function FeaturedQuote({ quote, visible, delayMs }: { quote: Quote; visible: boolean; delayMs: number }) {
  return (
    <figure
      className={`relative transition-all duration-500 ease-out motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
    >
      <QuoteMark className="absolute -left-1 -top-6 text-[5.5rem] md:-top-8 md:text-[7rem]" />
      <blockquote className="relative pl-1 pt-6 text-xl font-medium leading-relaxed text-gray-800 md:pt-8 md:text-2xl md:leading-snug">
        {emphasizeProof(quote.text)}
      </blockquote>
      <QuoteAttribution quote={quote} />
    </figure>
  );
}

function SecondaryQuote({
  quote,
  visible,
  delayMs
}: {
  quote: Quote;
  visible: boolean;
  delayMs: number;
}) {
  return (
    <figure
      className={`relative transition-all duration-500 ease-out motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
    >
      <QuoteMark className="absolute -left-0.5 -top-3 text-4xl" />
      <blockquote className="relative pl-0.5 pt-4 text-base font-medium leading-relaxed text-gray-800">
        {emphasizeProof(quote.text)}
      </blockquote>
      <QuoteAttribution quote={quote} compact />
    </figure>
  );
}

export function Testimonial() {
  const quotes = siteConfig.quotes;
  const [featured, ...rest] = quotes;
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

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
    <section ref={sectionRef} className="border-y border-coop-border bg-white py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label="social_proof"
          title="Teams using CoopAI"
          description="Engineers and leads who stopped hunting context across Slack, tickets, and tribal knowledge."
        />

        <div className="mt-12 md:mt-14">
          <FeaturedQuote quote={featured} visible={visible} delayMs={0} />
        </div>

        {rest.length > 0 ? (
          <div className="mt-14 grid gap-10 border-t border-coop-border pt-12 md:mt-16 md:grid-cols-3 md:gap-8 md:pt-14">
            {rest.map((quote, i) => (
              <SecondaryQuote
                key={quote.text.slice(0, 40)}
                quote={quote}
                visible={visible}
                delayMs={120 + i * 90}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
