type StatusBadgeTone = "connected" | "available" | "reconnect";

type StatusBadgeProps = {
  connected: boolean;
  label?: string;
  /** When false, renders nothing for disconnected state (default). */
  showWhenDisconnected?: boolean;
  /** Override the default green/muted pairing (e.g. reconnect required). */
  tone?: StatusBadgeTone;
};

export function StatusBadge({
  connected,
  label,
  showWhenDisconnected = false,
  tone
}: StatusBadgeProps) {
  if (!connected && !showWhenDisconnected) {
    return null;
  }

  const text = label ?? (connected ? "Connected" : "Available");
  const resolvedTone: StatusBadgeTone = tone ?? (connected ? "connected" : "available");

  return (
    <span className={`admin-status admin-status--${resolvedTone}`}>
      <span className="admin-status-dot" aria-hidden />
      <span>{text}</span>
    </span>
  );
}
