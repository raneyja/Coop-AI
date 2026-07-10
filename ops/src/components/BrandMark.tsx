import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md";
};

export function BrandMark({ size = "md" }: BrandMarkProps) {
  const height = size === "sm" ? 22 : 28;

  return (
    <Image
      src="/coop-wordmark.png"
      alt="CoopAI"
      width={Math.round(height * 3)}
      height={height}
      className="coop-logo-mark h-auto w-auto"
      style={{ height }}
      priority
    />
  );
}
