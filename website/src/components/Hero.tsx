import { Button, InstallExtensionButton } from "./Button";
import { HeroExampleCarousel } from "./HeroExampleCarousel";
import { HeroProductMock } from "./HeroProductMock";
import { siteConfig } from "@/lib/site.config";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-16 md:pt-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="animate-fade-up text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.1]">
            {siteConfig.tagline.split(",").map((part, i) => (
              <span key={i}>
                {i === 0 ? (
                  <>
                    {part.trim()},
                    <br />
                  </>
                ) : (
                  <span className="text-white/90">{part.trim()}</span>
                )}
              </span>
            ))}
          </h1>

          <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-coop-muted md:text-xl">
            {siteConfig.subheadline}
          </p>

          <div className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button href="/demo">Book a demo</Button>
            <InstallExtensionButton />
          </div>
        </div>

        <div className="mt-14 md:mt-16">
          <HeroProductMock />
        </div>

        <div className="mx-auto mt-10 w-full max-w-[36rem] md:mt-12">
          <HeroExampleCarousel compact />
        </div>
      </div>
    </section>
  );
}
