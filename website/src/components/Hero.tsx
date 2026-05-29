import { Button, InstallExtensionButton } from "./Button";
import { ProductScreenshot } from "./ProductScreenshot";
import { siteConfig } from "@/lib/site.config";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-16 md:pt-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="animate-fade-up text-sm font-medium uppercase tracking-widest text-coop-accent">
            Code intelligence for VS Code
          </p>
          <h1 className="animate-fade-up mt-4 text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.1]">
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

        <div className="mt-16 md:mt-20">
          <ProductScreenshot size="compact" />
        </div>
      </div>
    </section>
  );
}
