import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md";
  inverted?: boolean;
};

const DARK_MARK = { src: "/coop-wordmark.png", ratio: 990 / 332 };
const LIGHT_MARK = { src: "/coop-wordmark-white.png", ratio: 824 / 280 };

export function BrandMark({ size = "md", inverted = false }: BrandMarkProps) {
  const height = size === "sm" ? 22 : 28;
  const mark = inverted ? LIGHT_MARK : DARK_MARK;

  return (
    <Image
      src={mark.src}
      alt="CoopAI"
      width={Math.round(height * mark.ratio)}
      height={height}
      className="h-auto w-auto"
      style={{ height }}
      priority
    />
  );
}
