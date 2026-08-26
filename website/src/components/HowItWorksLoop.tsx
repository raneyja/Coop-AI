import Link from "next/link";
import { HOW_IT_WORKS_LOOP } from "@/lib/howItWorks";

/** Numbered 01 → 02 → 03 pipeline for the How CoopAI works page. */
export function HowItWorksLoop() {
  return (
    <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
      {HOW_IT_WORKS_LOOP.map((step, index) => (
        <li key={step.id} className="relative">
          {index < HOW_IT_WORKS_LOOP.length - 1 ? (
            <span
              className="pointer-events-none absolute right-0 top-8 hidden h-px w-6 translate-x-full bg-coop-border md:block lg:w-8"
              aria-hidden
            />
          ) : null}
          <Link
            href={`#${step.id}`}
            className="coop-card block h-full transition hover:border-gray-300 hover:shadow-sm"
          >
            <p className="font-mono text-xs text-gray-500">
              <span className="text-coop-index">//</span> {step.label}
            </p>
            <p className="mt-3 font-mono text-sm text-gray-400">{step.step}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{step.title}</p>
            <p className="mt-3 text-sm leading-relaxed text-coop-muted">{step.summary}</p>
          </Link>
        </li>
      ))}
    </ol>
  );
}
