"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearSession,
  defaultHomePath,
  getToken,
  isAdminRole,
  meFromAuthPayload,
  restoreSessionFromCookie,
  saveSession
} from "@/lib/auth";
import {
  loginWithPassword,
  normalizeApiKeyInput,
  ssoStartUrl,
  startGoogleAuthUrl,
  validateSession
} from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

type SecondaryMode = "sso" | "key";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secondaryMode, setSecondaryMode] = useState<SecondaryMode>("sso");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("message") ?? params.get("error");
    if (oauthError) {
      setError(oauthError);
    }
  }, []);

  useEffect(() => {
    async function resumeSession() {
      const token = getToken();
      if (token) {
        const result = await validateSession(token);
        if (result.ok && result.data) {
          router.replace(defaultHomePath(result.data));
          return;
        }
        clearSession();
      }

      const restored = await restoreSessionFromCookie();
      if (restored) {
        router.replace(defaultHomePath(restored));
      }
    }

    void resumeSession();
  }, [router]);

  async function finishSignIn(
    token: string,
    payload: Record<string, unknown>,
    refreshToken?: string,
    orgNameOverride?: string
  ) {
    const me = meFromAuthPayload(payload);
    if (!isAdminRole(me)) {
      setError("This account does not have admin permissions. Use an owner or admin account.");
      return;
    }
    saveSession(token, me, orgNameOverride, refreshToken);
    router.replace(defaultHomePath(me));
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    const result = await loginWithPassword(trimmedEmail, password);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Sign-in failed.");
      return;
    }

    const token = String(result.data.accessToken ?? "").trim();
    if (!token) {
      setError("Sign-in response was incomplete.");
      return;
    }

    await finishSignIn(token, result.data, result.data.refreshToken);
  }

  async function handleApiKeySubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = normalizeApiKeyInput(apiKey);
    if (!token) {
      setError("Enter your automation API key.");
      return;
    }
    if (!token.startsWith("coop_")) {
      setError("API keys start with coop_. Check that you copied the full key.");
      return;
    }
    if (token.length !== 69) {
      setError(`API key should be 69 characters (yours is ${token.length}). Copy the full coop_… key with no spaces.`);
      return;
    }

    setLoading(true);
    const result = await validateSession(token);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Invalid API key.");
      return;
    }

    await finishSignIn(token, result.data, undefined, orgName);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Sign in</h1>
          <p className="mt-2 text-sm text-coop-muted">Organization admin console</p>
        </div>

        <div className="rounded-md border border-coop-border p-5">
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="admin-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="admin-input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="password" className="admin-label">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-coop-muted hover:text-white">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                className="admin-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="admin-btn-primary w-full py-2.5" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {error ? (
            <p className="mt-4 rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
            <span className="text-xs text-coop-muted">or</span>
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
          </div>

          <a href={startGoogleAuthUrl()} className="admin-btn-secondary block w-full py-2.5 text-center">
            Continue with Google
          </a>

          <details className="mt-5 rounded-sm border border-coop-border/60 p-3">
            <summary className="cursor-pointer text-sm text-coop-muted hover:text-white">
              More sign-in options
            </summary>
            <div className="mt-4 space-y-4">
              <div className="flex rounded-sm border border-coop-border p-0.5">
                <button
                  type="button"
                  className={`flex-1 rounded-sm px-3 py-1.5 font-mono text-sm transition ${
                    secondaryMode === "sso" ? "bg-coop-surface text-white" : "text-coop-muted hover:text-white"
                  }`}
                  onClick={() => setSecondaryMode("sso")}
                >
                  SSO
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-sm px-3 py-1.5 font-mono text-sm transition ${
                    secondaryMode === "key" ? "bg-coop-surface text-white" : "text-coop-muted hover:text-white"
                  }`}
                  onClick={() => setSecondaryMode("key")}
                >
                  API key
                </button>
              </div>

              {secondaryMode === "sso" ? (
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
                    />
                  </div>
                  <p className="text-xs text-coop-muted">Enterprise SAML SSO only.</p>
                  <a
                    href={orgName.trim() ? ssoStartUrl(orgName.trim()) : "#"}
                    className={`admin-btn-secondary block w-full py-2.5 text-center ${
                      !orgName.trim() ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    Continue with SSO
                  </a>
                </div>
              ) : (
                <form onSubmit={handleApiKeySubmit} className="space-y-4">
                  <div>
                    <label htmlFor="apiKey" className="admin-label">
                      Automation API key
                    </label>
                    <input
                      id="apiKey"
                      type="text"
                      className="admin-input font-mono text-sm"
                      placeholder="coop_…"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <p className="text-xs text-coop-muted">
                    For scripts and CI only. Day-to-day sign-in uses email, Google, or SSO.
                  </p>
                  <button type="submit" className="admin-btn-secondary w-full py-2.5" disabled={loading}>
                    {loading ? "Verifying…" : "Sign in with API key"}
                  </button>
                </form>
              )}
            </div>
          </details>
        </div>

        <p className="mt-6 text-center text-sm text-coop-muted">
          No account yet?{" "}
          <Link href="/signup" className="text-white hover:underline">
            Create one
          </Link>
        </p>

        <p className="mt-3 text-center font-mono text-xs text-coop-muted">
          Session stored in this browser only.
        </p>
      </div>
    </div>
  );
}
