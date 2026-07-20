"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clearSession,
  defaultHomePath,
  meFromAuthPayload,
  saveSession,
  signOutRemote
} from "@/lib/auth";
import { acceptInviteWithPassword, fetchInvitePreview } from "@/lib/coopApi";
import { timezoneOptionsWithDefault, detectBrowserTimezone } from "@/lib/timezones";
import { BrandMark } from "@/components/BrandMark";

const PASSWORD_MIN_LENGTH = 12;

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

type InvitePreview = {
  email: string;
  orgName: string;
  invitedBy?: string;
  source?: string;
};

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const timezoneOptions = useMemo(() => timezoneOptionsWithDefault(), []);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [timezone, setTimezone] = useState(detectBrowserTimezone);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Activation / invite links must not reuse another browser session.
    async function clearExistingSession() {
      await signOutRemote();
      clearSession();
    }
    void clearExistingSession();
  }, []);

  useEffect(() => {
    async function loadPreview() {
      if (!token) {
        setPreviewError("This invitation link is missing or malformed.");
        setLoadingPreview(false);
        return;
      }

      // QA / send-test-emails used to embed literal preview-* tokens.
      if (token.startsWith("preview-")) {
        setPreviewError(
          "This was an email layout preview — the link is not a live invite. Real invites use a one-time token from your admin."
        );
        setLoadingPreview(false);
        return;
      }

      setLoadingPreview(true);
      const result = await fetchInvitePreview(token);
      setLoadingPreview(false);

      if (!result.ok || !result.data) {
        setPreviewError(result.error ?? "This invitation link is invalid or has expired.");
        return;
      }

      setPreview({
        email: String(result.data.email ?? ""),
        orgName: String(result.data.orgName ?? ""),
        invitedBy: result.data.invitedBy ? String(result.data.invitedBy) : undefined,
        source: result.data.source ? String(result.data.source) : undefined
      });
    }

    void loadPreview();
  }, [token]);

  async function finishAcceptance(tokenValue: string, payload: Record<string, unknown>, refreshToken?: string) {
    const me = meFromAuthPayload(payload);
    const role = (me.role ?? "").toLowerCase();
    if (role !== "admin" && role !== "member" && role !== "owner") {
      setError("This invitation could not be activated for your account.");
      return;
    }
    saveSession(tokenValue, me, preview?.orgName, refreshToken);
    router.replace(defaultHomePath(me));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (!trimmedFirst || !trimmedLast) {
      setError("First and last name are required.");
      return;
    }
    if (!timezone.trim()) {
      setError("Select your timezone.");
      return;
    }

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
    const result = await acceptInviteWithPassword(token, password, {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      timezone: timezone.trim()
    });
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not accept your invitation.");
      return;
    }

    const accessToken = String(result.data.accessToken ?? "").trim();
    if (!accessToken) {
      setError("Invitation acceptance response was incomplete.");
      return;
    }

    await finishAcceptance(accessToken, result.data, result.data.refreshToken);
  }

  if (!token || previewError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
        <div className="w-full max-w-md text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">Link unavailable</h1>
          <p className="mt-3 text-sm text-coop-muted">
            {previewError ?? "This link is missing or malformed."}
          </p>
          <p className="mt-6 text-sm text-coop-muted">
            Check your email for a newer activation link, or{" "}
            <Link href="/login" className="text-white hover:underline">
              sign in
            </Link>{" "}
            if you already set a password.
          </p>
        </div>
      </div>
    );
  }

  if (loadingPreview || !preview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
        <div className="w-full max-w-md text-center">
          <BrandMark size="md" />
          <p className="mt-6 text-sm text-coop-muted">Loading…</p>
        </div>
      </div>
    );
  }

  const isCheckoutActivation = preview.source === "checkout";
  const headline = isCheckoutActivation ? "Activate your account" : "Join your team";
  const subtitle = isCheckoutActivation
    ? `${preview.orgName} is ready. Create your password to open the admin portal.`
    : preview.invitedBy
      ? `${preview.invitedBy} invited you to join ${preview.orgName}.`
      : `You've been invited to join ${preview.orgName}.`;
  const helperCopy = isCheckoutActivation
    ? "Set your password to finish setup. You’ll be signed in afterward."
    : "Create your CoopAI account to access repositories, connect your tools, and install the VS Code extension.";
  const submitLabel = isCheckoutActivation
    ? loading
      ? "Activating…"
      : "Activate and continue"
    : loading
      ? "Creating your account…"
      : "Create account and continue";
  const footerPrompt = isCheckoutActivation ? "Already activated?" : "Already joined?";

  return (
    <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="md" />
          <h1 className="mt-6 text-xl font-medium">{headline}</h1>
          <p className="mt-2 text-sm text-coop-muted">{subtitle}</p>
        </div>

        <div className="rounded-md border border-coop-border p-5">
          <p className="mb-5 text-sm text-coop-muted">{helperCopy}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="admin-label">
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  className="admin-input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
              </div>
              <div>
                <label htmlFor="lastName" className="admin-label">
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  className="admin-input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="admin-label">
                Work email
              </label>
              <input
                id="email"
                type="email"
                className="admin-input bg-white/[0.03] text-coop-muted"
                value={preview.email}
                readOnly
                aria-readonly
              />
            </div>

            <div>
              <label htmlFor="company" className="admin-label">
                Company
              </label>
              <input
                id="company"
                type="text"
                className="admin-input bg-white/[0.03] text-coop-muted"
                value={preview.orgName}
                readOnly
                aria-readonly
              />
            </div>

            <div>
              <label htmlFor="timezone" className="admin-label">
                Timezone
              </label>
              <select
                id="timezone"
                className="admin-input"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                required
              >
                {timezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

            {error ? (
              <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <button type="submit" className="admin-btn-primary w-full py-2.5" disabled={loading}>
              {submitLabel}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-coop-muted">
          {footerPrompt}{" "}
          <Link href="/login" className="text-white hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-coop-dark px-4">
          <p className="text-sm text-coop-muted">Loading…</p>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
