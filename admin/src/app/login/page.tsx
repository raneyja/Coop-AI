"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, isAdminRole, saveSession } from "@/lib/auth";
import { ssoStartUrl, validateApiKey } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"key" | "sso">("key");
  const [orgName, setOrgName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace("/");
    }
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = apiKey.trim();
    if (!token) {
      setError("Enter your organization admin API key.");
      return;
    }
    if (!token.startsWith("coop_")) {
      setError("API keys start with coop_. Check that you copied the full key.");
      return;
    }

    setLoading(true);
    const result = await validateApiKey(token);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Invalid API key.");
      return;
    }

    if (!isAdminRole(result.data)) {
      setError("This API key does not have admin permissions. Use an owner or admin key.");
      return;
    }

    saveSession(token, result.data, orgName);
    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Sign in</h1>
          <p className="mt-2 text-sm text-coop-muted">Organization admin console</p>
        </div>

        <div className="admin-card">
          <div className="mb-4 flex rounded-sm border border-coop-border p-0.5">
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 font-mono text-sm transition ${
                mode === "key" ? "bg-coop-surface text-white" : "text-coop-muted hover:text-white"
              }`}
              onClick={() => setMode("key")}
            >
              API key
            </button>
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 font-mono text-sm transition ${
                mode === "sso" ? "bg-coop-surface text-white" : "text-coop-muted hover:text-white"
              }`}
              onClick={() => setMode("sso")}
            >
              SSO
            </button>
          </div>

          {mode === "key" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="apiKey" className="admin-label">
                  Admin API key
                </label>
                <input
                  id="apiKey"
                  type="password"
                  className="admin-input"
                  placeholder="coop_…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              {error && (
                <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}
              <button type="submit" className="admin-btn-primary w-full py-2.5" disabled={loading}>
                {loading ? "Verifying…" : "Sign in"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="ssoOrg" className="admin-label">
                  Organization name
                </label>
                <input
                  id="ssoOrg"
                  type="text"
                  className="admin-input"
                  placeholder="Acme Engineering"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                />
              </div>
              <p className="text-xs text-coop-muted">Enterprise SSO only. Pro orgs use an API key.</p>
              <a
                href={orgName.trim() ? ssoStartUrl(orgName.trim()) : "#"}
                className={`admin-btn-primary block w-full py-2.5 text-center ${!orgName.trim() ? "pointer-events-none opacity-50" : ""}`}
              >
                Continue with SSO
              </a>
            </div>
          )}
        </div>

        <p className="mt-6 text-center font-mono text-xs text-coop-muted">
          Session stored in this browser only.
        </p>
      </div>
    </div>
  );
}
