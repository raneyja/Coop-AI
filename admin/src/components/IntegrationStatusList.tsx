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
          <div
            key={def.id}
            className={`admin-list-row${installed ? " admin-list-row--connected" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{def.name}</p>
              {installed && status?.detail ? (
                <p className="mt-0.5 text-xs text-coop-muted">{status.detail}</p>
              ) : !installed ? (
                <p className="mt-0.5 text-xs text-coop-muted/70">Available</p>
              ) : null}
            </div>
            {loading ? (
              <span className="text-xs text-coop-muted">…</span>
            ) : (
              <StatusBadge connected={installed} />
            )}
          </div>
        );
      })}
    </div>
  );
}
