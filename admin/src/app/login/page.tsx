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
  saveSession,
  signOutRemote
} from "@/lib/auth";
import { loginWithPassword, ssoStartUrl, startGoogleAuthUrl, validateSession } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

function readLoginQuery(): { forceSignedOut: boolean; email: string; oauthError: string | null } {
  const params = new URLSearchParams(window.location.search);
  const forceSignedOut = params.get("signedOut") === "1" || params.get("fresh") === "1";
  const email = params.get("email")?.trim() ?? "";
  const oauthError = params.get("message") ?? params.get("error");
  return { forceSignedOut, email, oauthError };
}

function stripFreshLoginParams(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("signedOut") && !url.searchParams.has("fresh")) {
    return;
  }
  url.searchParams.delete("signedOut");
  url.searchParams.delete("fresh");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      const { forceSignedOut, email: emailParam, oauthError } = readLoginQuery();
      if (oauthError) {
        setError(oauthError);
      }
      if (emailParam) {
        setEmail(emailParam);
      }

      // Email / post-checkout CTAs: clear any existing portal session first.
      if (forceSignedOut) {
        await signOutRemote();
        clearSession();
        stripFreshLoginParams();
        if (!cancelled) {
          setReady(true);
        }
        return;
      }

      const token = getToken();
      if (token) {
        const result = await validateSession(token);
        if (cancelled) {
          return;
        }
        if (result.ok && result.data) {
          router.replace(defaultHomePath(result.data));
          return;
        }
        clearSession();
      }

      const restored = await restoreSessionFromCookie();
      if (cancelled) {
        return;
      }
      if (restored) {
        router.replace(defaultHomePath(restored));
        return;
      }

      setReady(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
        <p className="text-sm text-coop-muted">Preparing sign-in…</p>
      </div>
    );
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

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
            <span className="text-xs text-coop-muted">or SSO</span>
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
          </div>

          <div className="space-y-3">
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
            <p className="text-xs text-coop-muted">
              Exact organization name required. Next you&apos;ll be redirected to your company identity
              provider (Okta, Microsoft Entra, etc.) to sign in securely.
            </p>
            <a
              href={orgName.trim() ? ssoStartUrl(orgName.trim()) : "#"}
              className={`admin-btn-secondary block w-full py-2.5 text-center ${
                !orgName.trim() ? "pointer-events-none opacity-50" : ""
              }`}
              onClick={(event) => {
                if (!orgName.trim()) {
                  event.preventDefault();
                  setError("Enter your organization name to continue with SSO.");
                }
              }}
            >
              Continue with SSO
            </a>
          </div>
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
