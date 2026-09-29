import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";

const SECURITY_POINTS = [
  "Source stays on your infrastructure. Zero-clone — we index metadata, ownership, and history, not a copy of the monorepo on every laptop.",
  "Server-side model router. Zero-retention configuration. Bring your own keys.",
  "We do not train on your code, prompts, or completions.",
  "SAML SSO, admin-connected integrations, and an audit log — org context your admin connected, not each person’s private accounts."
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
          description="Enterprise-confidential context stays under your control. CoopAI is the shared org layer, not a personal chatbot with your repo pasted in."
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
