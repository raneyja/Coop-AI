import type { OperatorStatus } from "@/lib/coopApi";

type StatusBadgeProps = {
  connected: boolean;
  label?: string;
  variant?: "default" | "warn" | "danger";
  showWhenDisconnected?: boolean;
};

export function StatusBadge({
  connected,
  label,
  variant = "default",
  showWhenDisconnected = false
}: StatusBadgeProps) {
  if (!connected && !showWhenDisconnected) {
    return null;
  }

  const text = label ?? (connected ? "Connected" : "Available");
  const variantClass =
    variant === "warn"
      ? "admin-status--warn"
      : variant === "danger"
        ? "text-red-300"
        : connected
          ? "admin-status--connected"
          : "admin-status--available";

  return (
    <span className={`admin-status ${variantClass}`}>
      <span className="admin-status-dot" aria-hidden />
      <span>{text}</span>
    </span>
  );
}

export function OperatorOrgStatusBadge({
  status,
  onboardingIncomplete
}: {
  status?: OperatorStatus;
  onboardingIncomplete?: boolean;
}) {
  if (status === "cancelled") {
    return <StatusBadge connected={false} label="Cancelled" variant="danger" showWhenDisconnected />;
  }
  if (status === "suspended") {
    return <StatusBadge connected={false} label="Suspended" variant="danger" showWhenDisconnected />;
  }
  if (onboardingIncomplete) {
    return <StatusBadge connected={false} label="Onboarding" variant="warn" showWhenDisconnected />;
  }
  return <StatusBadge connected label="Active" />;
}
