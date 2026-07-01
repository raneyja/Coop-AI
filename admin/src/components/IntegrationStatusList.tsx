import { INTEGRATIONS, type IntegrationStatus } from "@/lib/integrations";
import { StatusBadge } from "./StatusBadge";

type IntegrationStatusListProps = {
  integrations: IntegrationStatus[];
  loading?: boolean;
};

export function IntegrationStatusList({ integrations, loading }: IntegrationStatusListProps) {
  return (
    <div className="admin-list">
      {INTEGRATIONS.map((def) => {
        const status = integrations.find((s) => s.provider === def.id);
        const installed = status?.installed ?? false;
        return (
          <div key={def.id} className="admin-list-row !justify-start gap-3">
            <p className="min-w-[9rem] font-medium">{def.name}</p>
            {loading ? (
              <span className="text-xs text-coop-muted">…</span>
            ) : (
              <StatusBadge
                connected={installed}
                showWhenDisconnected={!installed}
                label={installed ? "Connected" : "Available"}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
