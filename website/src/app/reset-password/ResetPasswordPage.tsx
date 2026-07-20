"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import {
  authErrorClassName,
  authInputClassName,
  authSuccessClassName,
  PASSWORD_MIN_LENGTH,
  validatePasswordClient
} from "@/lib/auth";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const adminLoginUrl = useMemo(() => getAdminPortalLoginUrl(), []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (token.startsWith("preview-")) {
      setSubmitting(false);
      setError(
        "This was an email layout preview — the link is not a live reset. Request a real link from Forgot password."
      );
      return;
    }

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

    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };

    setSubmitting(false);
    if (!response.ok) {
      setError(data.error ?? "This reset link is invalid or expired.");
      return;
    }

    setSuccess(true);
  }

  if (token.startsWith("preview-")) {
    return (
      <>
        <PageHeader
          eyebrow="Account"
          title="Reset link preview"
          description="This was an email layout preview — not a live password reset."
          tight
        />
        <section className="mx-auto max-w-lg px-6 pb-24">
          <div className="coop-panel p-6">
            <p className={authErrorClassName}>
              Request a real link from the{" "}
              <Link href="/forgot-password" className="font-medium underline">
                forgot password
              </Link>{" "}
              page.
            </p>
          </div>
        </section>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <PageHeader
          eyebrow="Account"
          title="Reset link invalid"
          description="This password reset link is missing or malformed."
          tight
        />
        <section className="mx-auto max-w-lg px-6 pb-24">
          <div className="coop-panel p-6">
            <p className={authErrorClassName}>
              Request a new link from the{" "}
              <Link href="/forgot-password" className="font-medium underline">
                forgot password
              </Link>{" "}
              page.
            </p>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Choose a new password"
        description="Use at least 12 characters you have not used elsewhere."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          {success ? (
            <>
              <p className={authSuccessClassName}>
                Your password has been updated. Sign in with your new password.
              </p>
              <Button href="/login" className="w-full">
                Sign in
              </Button>
              <Button href={adminLoginUrl} external variant="secondary" className="w-full">
                Open admin portal
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-coop-muted">
                  New password
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
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-1 block text-sm text-coop-muted">
                  Confirm new password
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

              {error ? <p className={authErrorClassName}>{error}</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a] disabled:opacity-50"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
