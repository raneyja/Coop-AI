"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { AuthDivider, AuthFooterLink, GoogleAuthButton } from "@/components/AuthForm";
import {
  authErrorClassName,
  authInputClassName,
  redirectToAdminPortal,
  type AuthSession
} from "@/lib/auth";

type LoginResponse = AuthSession & {
  error?: string;
  code?: string;
  message?: string;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password
      })
    });
    const data = (await response.json().catch(() => ({}))) as LoginResponse;

    if (!response.ok || !data.accessToken || !data.refreshToken) {
      setSubmitting(false);
      if (data.code === "sso_required") {
        setError("Your organization requires SSO. Use Sign in with SSO from the admin portal.");
        return;
      }
      setError(data.error ?? "Email or password is incorrect.");
      return;
    }

    redirectToAdminPortal({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Sign in"
        description="Access your admin portal, integrations, and team settings."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          <GoogleAuthButton mode="login" disabled={submitting} />
          <AuthDivider />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm text-coop-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={authInputClassName}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-sm text-coop-muted">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs font-medium text-gray-900 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={authInputClassName}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? <p className={authErrorClassName}>{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a] disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <AuthFooterLink prompt="New to Coop AI?" href="/signup/free" label="Create a free account" />
        </div>
      </section>
    </>
  );
}
