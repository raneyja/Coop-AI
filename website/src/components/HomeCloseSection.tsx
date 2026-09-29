import { Button, InstallExtensionButton } from "./Button";
import { siteConfig } from "@/lib/site.config";

export function HomeCloseSection() {
  return (
    <section className="border-t border-white/10 py-20 md:py-24">
      <div className="mx-auto max-w-xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
          See CoopAI on your codebase
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/50">
          Install the extension, or spend 20 minutes on your actual repo with the founder.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <InstallExtensionButton
            variant="inverse"
            label="Install the free VS Code extension"
          />
          <Button href={siteConfig.links.demo} variant="inverse-secondary">
            Book a 20-minute demo on your repo
          </Button>
        </div>
      </div>
    </section>
  );
}
