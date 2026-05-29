import Link from "next/link";
import { marketplaceHref } from "@/lib/site.config";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-white text-coop-dark hover:bg-white/90",
  secondary: "border border-white/15 bg-white/5 text-white hover:bg-white/10",
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
  const classes = `inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition ${variants[variant]} ${className}`;

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
