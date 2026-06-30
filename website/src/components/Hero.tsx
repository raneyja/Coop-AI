import { Button, InstallExtensionButton } from "./Button";
import { HeroDemoArtifact } from "./HeroDemoArtifact";
import { siteConfig } from "@/lib/site.config";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-10 md:pb-20 md:pt-14 lg:pt-16">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-16 text-center lg:text-left">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-5xl lg:text-[3.25rem] xl:text-6xl">
            {siteConfig.tagline.split(",").map((part, i) => (
              <span key={i}>
                {i === 0 ? (
                  <>
                    {part.trim()},
                    <br />
                  </>
                ) : (
                  <span>{part.trim()}</span>
                )}
              </span>
            ))}
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-gray-600 md:text-xl lg:mx-0">
            {siteConfig.subheadline}
          </p>
        </div>

        <HeroDemoArtifact />

        <div className="mt-16 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
          <Button href="/demo">Book a demo</Button>
          <InstallExtensionButton />
        </div>
      </div>
    </section>
  );
}
