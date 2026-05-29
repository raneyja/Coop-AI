import Image from "next/image";

type ProductScreenshotProps = {
  /** Compact layout (~72% of full width) for home hero and product page. */
  size?: "default" | "compact";
};

const SIZES = {
  default: "max-w-5xl",
  compact: "max-w-[46.24rem]"
} as const;

export function ProductScreenshot({ size = "compact" }: ProductScreenshotProps) {
  const maxWidth = SIZES[size];

  return (
    <div className={`relative mx-auto w-full ${maxWidth}`}>
      {/* Abstract glow */}
      <div className="pointer-events-none absolute -inset-x-8 -top-12 h-64 bg-hero-glow" aria-hidden />

      {/* Grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 bg-hero-grid bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        aria-hidden
      />

      <div className="relative rounded-2xl border border-white/10 bg-coop-surface/80 p-2 shadow-2xl shadow-coop-blue/10 backdrop-blur-sm">
        <div className="overflow-hidden rounded-xl border border-white/5">
          <Image
            src="/screenshots/product-dark.png"
            alt="CoopAI sidebar in VS Code showing quick actions and chat"
            width={1920}
            height={1080}
            className="w-full"
            priority
          />
        </div>
      </div>

      {/* Decorative accent */}
      <div
        className="pointer-events-none absolute -bottom-6 left-1/2 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-coop-blue/50 to-transparent"
        aria-hidden
      />
    </div>
  );
}
