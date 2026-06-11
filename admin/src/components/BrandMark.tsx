import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md";
};

export function BrandMark({ size = "md" }: BrandMarkProps) {
  const logoHeight = size === "sm" ? 22 : 30;

  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/coop-logo.png"
        alt=""
        width={logoHeight}
        height={logoHeight}
        className="coop-logo-mark"
        style={{ height: logoHeight, width: "auto" }}
        priority
      />
      <span
        className={`font-semibold tracking-tight text-white ${size === "sm" ? "text-base" : "text-lg"}`}
      >
        CoopAI
      </span>
    </div>
  );
}
