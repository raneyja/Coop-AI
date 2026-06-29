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
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="coop-panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-coop-border bg-gray-100 px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
            <span className="ml-2 font-mono text-[11px] text-gray-500">coop — zsh</span>
          </div>

          <div className="px-6 py-10 md:px-10 md:py-12">
            <p className="coop-prompt-line">coop demo --repo yours</p>
            <h2 className="mt-4 max-w-2xl text-2xl font-semibold text-gray-900 md:text-3xl">{title}</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-coop-muted">{description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={primaryHref}>{primaryLabel}</Button>
              {showInstall && <InstallExtensionButton />}
            </div>
            <p className="mt-6 text-xs text-gray-500">code intelligence from your entire stack</p>
          </div>
        </div>
      </div>
    </section>
  );
}
