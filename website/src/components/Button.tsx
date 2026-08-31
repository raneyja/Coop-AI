import Link from "next/link";
import { installExtensionHref } from "@/lib/site.config";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "inverse"
  | "inverse-secondary";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center rounded font-medium transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2";

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-6 py-2 text-sm"
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-coop-index text-white hover:bg-[#2ea043] focus-visible:outline-gray-900",
  secondary:
    "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus-visible:outline-gray-900",
  ghost: "text-coop-muted hover:text-gray-900 focus-visible:outline-gray-900",
  inverse: "bg-white text-gray-900 hover:bg-gray-100 focus-visible:outline-white",
  "inverse-secondary":
    "border border-white/25 bg-transparent text-white hover:bg-white/10 focus-visible:outline-white"
};

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  external?: boolean;
  className?: string;
};

export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  external,
  className = ""
}: ButtonProps) {
  const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`;

  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

export function InstallExtensionButton({
  className = "",
  variant = "secondary",
  size = "md"
}: {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const href = installExtensionHref();
  const external = href.startsWith("http");

  return (
    <Button href={href} variant={variant} size={size} external={external} className={className}>
      Install extension
    </Button>
  );
}
