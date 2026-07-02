"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { authErrorClassName, authInputClassName, authSuccessClassName } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() })
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };

    setSubmitting(false);
    if (!response.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Reset your password"
        description="Enter the email on your account and we'll send a reset link."
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          {submitted ? (
            <>
              <p className={authSuccessClassName}>
                If an account exists for <strong>{email}</strong>, we sent a password reset link.
                Check your inbox and spam folder.
              </p>
              <p className="text-center text-sm text-coop-muted">
                <Link href="/login" className="font-medium text-gray-900 hover:underline">
                  Back to sign in
                </Link>
              </p>
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
                  className={authInputClassName}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {error ? <p className={authErrorClassName}>{error}</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a] disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>

              <p className="text-center text-sm text-coop-muted">
                <Link href="/login" className="font-medium text-gray-900 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
