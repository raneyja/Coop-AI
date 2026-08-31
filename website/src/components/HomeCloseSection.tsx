import { Button, InstallExtensionButton } from "./Button";

export function HomeCloseSection() {
  return (
    <section className="border-t border-white/10 py-20 md:py-24">
      <div className="mx-auto max-w-xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
          See CoopAI on your codebase
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/50">
          Book a demo with our team or install the free VS Code extension from the Marketplace.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <InstallExtensionButton variant="inverse" />
          <Button href="/demo" variant="inverse-secondary">
            Book a demo
          </Button>
        </div>
      </div>
    </section>
  );
}
