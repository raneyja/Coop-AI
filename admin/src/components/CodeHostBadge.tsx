import type { CodeHostProvider } from "@/lib/integrations";
import { codeHostBadgeLabel, parseCodeHostFromRepoId } from "@/lib/indexingProgress";

const CODE_HOST_CHIP_CLASS: Record<CodeHostProvider, string> = {
  github: "border-white/15 bg-white/[0.06] text-white",
  gitlab: "border-orange-500/30 bg-orange-950/30 text-orange-200",
  bitbucket: "border-sky-500/30 bg-sky-950/30 text-sky-200"
};

type CodeHostBadgeProps = {
  repoId: string;
};

/** Host chip matching Indexing table (GitHub / GitLab / Bitbucket). */
export function CodeHostBadge({ repoId }: CodeHostBadgeProps): React.ReactElement {
  const host = parseCodeHostFromRepoId(repoId);
  const label = codeHostBadgeLabel(repoId);
  if (!host) {
    return <span className="text-xs text-coop-muted">{label}</span>;
  }
  return (
    <span
      className={`inline-flex shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium ${CODE_HOST_CHIP_CLASS[host]}`}
    >
      {label}
    </span>
  );
}
