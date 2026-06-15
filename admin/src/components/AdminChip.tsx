import type { ReactNode } from "react";

type AdminChipVariant = "muted" | "plan-pro" | "plan-enterprise" | "plan-free";

type AdminChipProps = {
  children: ReactNode;
  variant?: AdminChipVariant;
  className?: string;
};

export function AdminChip({ children, variant = "muted", className }: AdminChipProps) {
  return (
    <span className={`admin-chip admin-chip--${variant}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
