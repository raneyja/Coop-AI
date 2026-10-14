import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";

const SECURITY_POINTS = [
  "Zero-clone repository intelligence uses remote files and server indexing. Durable indexes can contain source chunks; inference can transmit selected context.",
  "Server-side model routing with operator-configured provider keys. Retention and training terms require actual account verification.",
  "Conversation history can persist locally and in synced server storage; clearing local chat does not erase every stored copy.",
  "SAML sign-in, configurable integration scope and selected-action audit records. Qualify the supported deployment and access boundaries."
] as const;

type HomeSecurityStripProps = {
  tone?: "light" | "dark";
};

export function HomeSecurityStrip({ tone = "light" }: HomeSecurityStripProps) {
  const dark = tone === "dark";

  return (
    <section
      className={
        dark
          ? "border-t border-white/10 py-16 md:py-20"
          : "border-t border-coop-border py-16 md:py-20"
      }
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          tone={tone}
          title="Built for teams that cannot paste the monorepo into a chatbot."
          description="Review how repository and integration context reaches storage and configured inference providers, and which controls need deployment-specific evidence."
        />

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {SECURITY_POINTS.map((point) => (
            <li
              key={point.slice(0, 48)}
              className={
                dark
                  ? "rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-relaxed text-white/60"
                  : "rounded-2xl border border-coop-border bg-white p-5 text-sm leading-relaxed text-coop-muted"
              }
            >
              {point}
            </li>
          ))}
        </ul>

        <p className="mt-8">
          <Link
            href="/security"
            className={
              dark
                ? "text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline"
                : "text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            }
          >
            Architecture &amp; data handling →
          </Link>
        </p>
      </div>
    </section>
  );
}
