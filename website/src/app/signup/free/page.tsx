"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import { marketplaceHref } from "@/lib/site.config";

type SignupResponse = {
  apiKey?: string;
  adminPortalLoginUrl?: string;
  error?: string;
  code?: string;
};

export default function FreeSignupPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [adminPortalLoginUrl, setAdminPortalLoginUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const fallbackAdminPortalLoginUrl = useMemo(() => getAdminPortalLoginUrl(), []);
  const installHref = useMemo(() => marketplaceHref() ?? "/manual#get-started", []);
  const isInstallExternal = installHref.startsWith("http://") || installHref.startsWith("https://");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCopyState("idle");

    const response = await fetch("/api/signup/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        displayName: displayName.trim() || undefined
      })
    });
    const data = (await response.json().catch(() => ({}))) as SignupResponse;

    setSubmitting(false);
    if (!response.ok || !data.apiKey) {
      if (data.code === "email_taken") {
        setError("That email is already registered. Sign in from the admin portal or use a different email.");
        return;
      }
      setError(data.error ?? "We could not create your free account. Please try again.");
      return;
    }

    setApiKey(data.apiKey);
    setAdminPortalLoginUrl(data.adminPortalLoginUrl ?? null);
    setEmail("");
    setDisplayName("");
  }

  async function copyApiKey() {
    if (!apiKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("failed");
    }
  }

  const resolvedAdminPortalUrl = adminPortalLoginUrl || fallbackAdminPortalLoginUrl;

  return (
    <>
      <PageHeader
        eyebrow="Developer"
        title="Get started free"
        description="Create your free Coop AI developer account and get your API key immediately."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          {apiKey ? (
            <>
              <p className="rounded-sm border border-coop-index/30 bg-coop-index/10 px-4 py-3 text-sm leading-relaxed text-white/90">
                Your API key is shown once. Copy it now and store it securely before leaving this page.
              </p>

              <div>
                <label className="mb-2 block text-sm text-coop-muted">API key</label>
                <div className="rounded-sm border border-coop-border bg-coop-dark p-3">
                  <code className="block break-all font-mono text-xs text-white">{apiKey}</code>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={copyApiKey}
                    className="inline-flex items-center justify-center rounded-sm border border-coop-border bg-coop-surface px-3 py-2 text-xs font-medium text-white/90 hover:border-coop-muted/50 hover:bg-[#1c2128]"
                  >
                    Copy API key
                  </button>
                  <p className="text-xs text-coop-muted">
                    {copyState === "copied" ? (
                      <span className="text-coop-index">Copied</span>
                    ) : copyState === "failed" ? (
                      <span className="text-red-300">Could not copy. Select and copy manually.</span>
                    ) : (
                      "Keep this key private."
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-t border-coop-border pt-5">
                <Button href={resolvedAdminPortalUrl} external className="w-full">
                  Open admin portal
                </Button>
                <Button
                  href={installHref}
                  variant="secondary"
                  external={isInstallExternal}
                  className="w-full"
                >
                  Install VS Code extension
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm text-coop-muted">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 text-white"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="displayName" className="mb-1 block text-sm text-coop-muted">
                  Display name / workspace name (optional)
                </label>
                <input
                  id="displayName"
                  type="text"
                  className="w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 text-white"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              {error ? (
                <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-coop-dark hover:bg-[#46c35a] disabled:opacity-50"
              >
                {submitting ? "Creating account…" : "Create free account"}
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
