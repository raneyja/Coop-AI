"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/coopApi";
import { BrandMark } from "@/components/BrandMark";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }

    setLoading(true);
    const result = await requestPasswordReset(trimmed);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? "Could not send reset email.");
      return;
    }

    setMessage(
      result.data?.message ?? "If an account exists for that email, we sent a reset link."
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Reset password</h1>
          <p className="mt-2 text-sm text-coop-muted">
            We&apos;ll email a link to reset your password.
          </p>
        </div>

        <div className="rounded-md border border-coop-border p-5">
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
            {error ? (
              <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-sm border border-coop-index/30 bg-coop-index/10 px-3 py-2 text-sm text-coop-index">
                {message}
              </p>
            ) : null}
            <button type="submit" className="admin-btn-primary w-full py-2.5" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-coop-muted">
          <Link href="/login" className="admin-link">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
