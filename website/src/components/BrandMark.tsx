import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md";
};

export function BrandMark({ size = "md" }: BrandMarkProps) {
  const logoHeight = size === "sm" ? 22 : 30;

  return (
    <>
      <Image
        src="/coop-logo.png"
        alt=""
        width={logoHeight}
        height={logoHeight}
        className="h-auto w-auto invert mix-blend-screen opacity-90"
        style={{ height: logoHeight }}
      />
      <span
        className={`font-semibold tracking-tight text-white ${size === "sm" ? "text-base" : "text-lg"}`}
      >
        CoopAI
      </span>
    </>
  );
}
