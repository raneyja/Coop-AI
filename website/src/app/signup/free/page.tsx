"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { AuthDivider, AuthFooterLink, GoogleAuthButton } from "@/components/AuthForm";
import {
  authErrorClassName,
  authInputClassName,
  authSuccessClassName,
  PASSWORD_MIN_LENGTH,
  redirectToAdminPortal,
  validatePasswordClient,
  type AuthSession
} from "@/lib/auth";

type SignupResponse = AuthSession & {
  error?: string;
  code?: string;
  message?: string;
};

export default function FreeSignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    const passwordError = validatePasswordClient(password);
    if (passwordError) {
      setSubmitting(false);
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setSubmitting(false);
      setError("Passwords do not match.");
      return;
    }

    const response = await fetch("/api/signup/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password,
        orgName: orgName.trim() || undefined
      })
    });
    const data = (await response.json().catch(() => ({}))) as SignupResponse;

    if (!response.ok || !data.accessToken || !data.refreshToken) {
      setSubmitting(false);
      if (data.code === "email_taken" || data.error === "email_taken") {
        setError("That email is already registered. Sign in or reset your password.");
        return;
      }
      setError(data.error ?? "We could not create your account. Please try again.");
      return;
    }

    setSuccessMessage("Account created. Opening your admin portal…");
    redirectToAdminPortal({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Developer"
        title="Get started free"
        description="Create your Coop AI account with email and password. No credit card required."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          {successMessage ? (
            <p className={authSuccessClassName}>{successMessage}</p>
          ) : (
            <>
              <GoogleAuthButton mode="signup" orgName={orgName} disabled={submitting} />
              <AuthDivider />

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm text-coop-muted">
                    Work email
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
                  <label htmlFor="password" className="mb-1 block text-sm text-coop-muted">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_LENGTH}
                    className={authInputClassName}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-coop-muted">
                    At least {PASSWORD_MIN_LENGTH} characters.
                  </p>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="mb-1 block text-sm text-coop-muted">
                    Confirm password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_LENGTH}
                    className={authInputClassName}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="orgName" className="mb-1 block text-sm text-coop-muted">
                    Workspace name <span className="text-coop-muted/70">(optional)</span>
                  </label>
                  <input
                    id="orgName"
                    type="text"
                    autoComplete="organization"
                    placeholder="My team"
                    className={authInputClassName}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </div>

                {error ? <p className={authErrorClassName}>{error}</p> : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a] disabled:opacity-50"
                >
                  {submitting ? "Creating account…" : "Create free account"}
                </button>
              </form>

              <AuthFooterLink prompt="Already have an account?" href="/login" label="Sign in" />
            </>
          )}

          <p className="border-t border-coop-border pt-4 text-center text-xs leading-relaxed text-coop-muted">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="text-gray-900 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-gray-900 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
