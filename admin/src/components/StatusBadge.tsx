type StatusBadgeProps = {
  connected: boolean;
  label?: string;
  /** When false, renders nothing for disconnected state (default). */
  showWhenDisconnected?: boolean;
};

export function StatusBadge({
  connected,
  label,
  showWhenDisconnected = false
}: StatusBadgeProps) {
  if (!connected && !showWhenDisconnected) {
    return null;
  }

  const text = label ?? (connected ? "Connected" : "Available");

  return (
    <span
      className={`admin-status ${
        connected ? "admin-status--connected" : "admin-status--available"
      }`}
    >
      <span className="admin-status-dot" aria-hidden />
      <span>{text}</span>
    </span>
  );
}
