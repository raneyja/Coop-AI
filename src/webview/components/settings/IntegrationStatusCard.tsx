import React from "react";
import type { MemberToolStatus } from "../../../chat/integrationStatusTypes";
import { memberToolStatusLabel } from "./integrationStatus";
import type { Preferences } from "./types";

type IntegrationStatusCardProps = {
  name: string;
  meta?: string;
  status: MemberToolStatus;
  description?: string;
};

function statusToneClass(status: MemberToolStatus): string {
  if (status === "ready") {
    return "coop-health-status--healthy";
  }
  if (status === "pending_admin_setup") {
    return "coop-health-status--degraded";
  }
  return "coop-health-status--offline";
}

export function IntegrationStatusCard({
  name,
  meta,
  status,
  description
}: IntegrationStatusCardProps): React.ReactElement {
  return (
    <div className="coop-settings-card space-y-2">
      {description ? <p className="coop-settings-card-desc">{description}</p> : null}
      <div className="coop-health-integration">
        <div className="min-w-0">
          <div className="coop-health-integration-name">{name}</div>
          {meta ? <div className="coop-health-integration-meta">{meta}</div> : null}
        </div>
        <span className={`coop-health-status shrink-0 ${statusToneClass(status)}`}>
          {memberToolStatusLabel(status)}
        </span>
      </div>
    </div>
  );
}

export function MemberAdminPortalLink({ prefs }: { prefs: Preferences }): React.ReactElement {
  const adminBase = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");
  return (
    <p className="coop-settings-card-desc px-0.5 mt-3">
      Need a tool connected?{" "}
      <a className="coop-text-btn" href={`${adminBase}/integrations`} target="_blank" rel="noreferrer">
        Ask your admin
      </a>{" "}
      to set it up in the admin portal.
    </p>
  );
}
