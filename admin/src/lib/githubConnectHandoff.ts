"use client";

const STORAGE_KEY = "coop_github_handoff_pending";

export function markGithubHandoffPending(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function clearGithubHandoffPending(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isGithubHandoffPending(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const ageMs = Date.now() - Number(raw);
    if (!Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function GitHubOrgInstallChecklist({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-coop-border/60 bg-white/[0.03] ${
        compact ? "p-3 text-xs" : "p-4 text-sm"
      }`}
    >
      <p className="font-medium text-white">GitHub org install — two roles</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-coop-muted">
        <li>
          <span className="text-white/90">Coop admin (you)</span> — connect GitHub in this portal and
          choose repos to index.
        </li>
        <li>
          <span className="text-white/90">GitHub org owner</span> — installs the Coop GitHub App on your
          company organization (not a personal account). If that is not you, use{" "}
          <span className="text-white/90">Send link to GitHub admin</span> below.
        </li>
      </ol>
      <p className="mt-2 text-coop-muted">
        Developers never re-index — they use your org&apos;s cloud index after you enable repos.
      </p>
    </div>
  );
}
