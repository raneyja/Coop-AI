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
import { registerWithPassword, startGoogleAuthUrl, validateSession } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

const PASSWORD_MIN_LENGTH = 12;

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function finishSignUp(token: string, payload: Record<string, unknown>, refreshToken?: string) {
    const me = meFromAuthPayload(payload);
    if (!isAdminRole(me)) {
      setError("This account does not have admin permissions.");
      return;
    }
    saveSession(token, me, orgName.trim() || undefined, refreshToken);
    router.replace(defaultHomePath(me));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const result = await registerWithPassword(trimmedEmail, password, orgName.trim() || undefined);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not create your account.");
      return;
    }

    const token = String(result.data.accessToken ?? "").trim();
    if (!token) {
      setError("Signup response was incomplete.");
      return;
    }

    await finishSignUp(token, result.data, result.data.refreshToken);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Create account</h1>
          <p className="mt-2 text-sm text-coop-muted">Start a free Coop AI workspace</p>
        </div>

        <div className="rounded-md border border-coop-border p-5">
          <a
            href={startGoogleAuthUrl("signup", orgName.trim() || undefined)}
            className="admin-btn-secondary block w-full py-2.5 text-center"
          >
            Sign up with Google
          </a>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
            <span className="text-xs text-coop-muted">or</span>
            <span className="h-px flex-1 bg-coop-border/80" aria-hidden />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <label htmlFor="password" className="admin-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="admin-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                required
              />
              <p className="mt-1 text-xs text-coop-muted">At least {PASSWORD_MIN_LENGTH} characters.</p>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="admin-label">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                className="admin-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                required
              />
            </div>
            <div>
              <label htmlFor="orgName" className="admin-label">
                Workspace name <span className="text-coop-muted/70">(optional)</span>
              </label>
              <input
                id="orgName"
                type="text"
                className="admin-input"
                placeholder="My team"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoComplete="organization"
              />
            </div>

            {error ? (
              <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <button type="submit" className="admin-btn-primary w-full py-2.5" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-coop-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-white hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
