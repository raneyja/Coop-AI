import Link from "next/link";
import { marketplaceHref } from "@/lib/site.config";

type ButtonVariant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center rounded px-6 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-black text-white hover:bg-gray-900",
  secondary:
    "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  ghost: "text-coop-muted hover:text-gray-900"
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
