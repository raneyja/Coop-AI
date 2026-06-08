import Link from "next/link";
import { marketplaceHref } from "@/lib/site.config";

type ButtonVariant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center rounded-sm px-4 py-2 text-sm font-medium font-mono transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-coop-index";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-coop-index text-coop-dark hover:bg-[#46c35a]",
  secondary:
    "border border-coop-border bg-coop-surface text-white/90 hover:border-coop-muted/50 hover:bg-[#1c2128]",
  ghost: "text-coop-muted hover:text-white"
};

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  external?: boolean;
  className?: string;
};

export function Button({ href, children, variant = "primary", external, className = "" }: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${className}`;

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

export function InstallExtensionButton({ className = "" }: { className?: string }) {
  const marketplace = marketplaceHref();

  if (marketplace) {
    return (
      <Button href={marketplace} variant="secondary" external className={className}>
        Install extension
      </Button>
    );
  }

  return (
    <Button href="/demo?intent=waitlist" variant="secondary" className={className}>
      Join waitlist for extension
    </Button>
  );
}
