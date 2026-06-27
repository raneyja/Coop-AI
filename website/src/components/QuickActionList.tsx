import { siteConfig } from "@/lib/site.config";

const COMMANDS: Record<string, string> = {
  "understand-repo": "coop understand-repo",
  "trace-decision": "coop trace-decision",
  "find-owner": "coop find-owner",
  "blast-radius": "coop blast-radius",
  "knowledge-gaps": "coop knowledge-gaps",
  "inline-complete": "coop complete",
  "edit-selection": "coop edit",
  "completion-routing": "coop complete --graph"
};

type FeatureRow = { id: string; title: string; description: string };

type QuickActionListProps = {
  features?: readonly FeatureRow[];
  includeCodeCreation?: boolean;
  showChat?: boolean;
  className?: string;
};

const rowGrid =
  "grid gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[11.5rem_minmax(0,1fr)] sm:items-start";

export function QuickActionList({
  features = siteConfig.features,
  includeCodeCreation = true,
  showChat = true,
  className = ""
}: QuickActionListProps) {
  const codeCreationFeatures = includeCodeCreation ? siteConfig.codeCreation.features : [];
  const allFeatures = [...features, ...codeCreationFeatures];

  return (
    <ul className={`divide-y divide-coop-border rounded-sm border border-coop-border bg-coop-editor ${className}`.trim()}>
      {allFeatures.map((f) => (
        <li key={f.id} className={rowGrid}>
          <code className="font-mono text-xs leading-5 text-coop-index sm:pt-0.5">
            {COMMANDS[f.id] ?? f.id}
          </code>
          <div className="min-w-0">
            <p className="font-mono text-sm text-white">{f.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">{f.description}</p>
          </div>
        </li>
      ))}
      {showChat ? (
        <li className={`${rowGrid} border-t border-dashed border-coop-border`}>
          <code className="font-mono text-xs leading-5 text-coop-muted/60 sm:pt-0.5">coop chat</code>
          <div className="min-w-0">
            <p className="font-mono text-sm text-white">Chat</p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              Free-form questions with repo context, saved prompts, and streaming responses from your
              choice of model.
            </p>
          </div>
        </li>
      ) : null}
    </ul>
  );
}
