"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearSession,
  defaultHomePath,
  getToken,
  meFromAuthPayload,
  restoreSessionFromCookie,
  saveSession
} from "@/lib/auth";
import { loginWithPassword, ssoStartUrl, startGoogleAuthUrl, validateSession } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Sign in</h1>
          <p className="mt-2 text-sm text-coop-muted">Sign in to your organization workspace</p>
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
