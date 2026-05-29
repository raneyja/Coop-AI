import { Button, InstallExtensionButton } from "./Button";

type CTASectionProps = {
  title?: string;
  description?: string;
  primaryLabel?: string;
  primaryHref?: string;
  showInstall?: boolean;
};

export function CTASection({
  title = "See CoopAI on your codebase",
  description = "Book a demo with our team or join the waitlist for the free VS Code extension.",
  primaryLabel = "Book a demo",
  primaryHref = "/demo",
  showInstall = true
}: CTASectionProps) {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-coop-surface to-coop-dark px-8 py-16 text-center md:px-16">
          <div className="pointer-events-none absolute inset-0 bg-hero-glow opacity-60" aria-hidden />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">{title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-coop-muted">{description}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button href={primaryHref}>{primaryLabel}</Button>
              {showInstall && <InstallExtensionButton />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
