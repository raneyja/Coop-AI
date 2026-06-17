import { Button, InstallExtensionButton } from "./Button";
import { FileContextStoryDemo } from "./FileContextStoryDemo";
import { HeroTerminalPrompt } from "./HeroTerminalPrompt";
import { siteConfig } from "@/lib/site.config";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-10 md:pb-20 md:pt-14 lg:pt-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center lg:gap-8 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:gap-12">
          <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-none lg:text-left">
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl md:leading-[1.1] lg:text-[3.25rem] xl:text-6xl">
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

            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-coop-muted md:text-xl lg:mx-0">
              {siteConfig.subheadline}
            </p>

            <HeroTerminalPrompt />

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Button href="/demo">Book a demo</Button>
              <InstallExtensionButton />
            </div>
          </div>

          <div className="mx-auto mt-10 w-full max-w-2xl lg:mt-0 lg:max-w-none lg:min-h-[552px]">
            <FileContextStoryDemo variant="homepage" />
          </div>
        </div>
      </div>
    </section>
  );
}
