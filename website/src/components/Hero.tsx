import { Button, InstallExtensionButton } from "./Button";
import { HeroDemoArtifact } from "./HeroDemoArtifact";
import { HeroGalaxyBackground } from "./HeroGalaxyBackground";
import { siteConfig } from "@/lib/site.config";

export function Hero() {
  const [lead, rest = ""] = siteConfig.tagline.split(",");

  return (
    <section className="relative overflow-hidden pb-20 pt-12 md:pb-28 md:pt-16">
      <HeroGalaxyBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6">
        <div className="mb-10 max-w-2xl text-center md:mb-12 lg:text-left">
          <h1 className="text-[2rem] font-semibold tracking-tight text-white md:text-4xl lg:text-[2.75rem] lg:leading-[1.15]">
            {lead.trim()},
            <br />
            {rest.trim()}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/50 md:text-base lg:mx-0">
            {siteConfig.subheadline}
          </p>
        </div>

        <HeroDemoArtifact tone="dark" />

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <InstallExtensionButton variant="inverse" />
          <Button href="/demo" variant="inverse-secondary">
            Book a demo
          </Button>
        </div>
      </div>
    </section>
  );
}
