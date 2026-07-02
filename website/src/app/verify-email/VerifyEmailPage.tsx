"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { getAdminPortalLoginUrl } from "@/lib/adminPortal";
import { authErrorClassName, authSuccessClassName } from "@/lib/auth";

type VerifyState = "loading" | "success" | "error";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const adminLoginUrl = useMemo(() => getAdminPortalLoginUrl(), []);

  const [state, setState] = useState<VerifyState>(token ? "loading" : "error");
  const [message, setMessage] = useState(
    token ? "" : "This verification link is missing or invalid."
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    async function verify() {
      const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        cache: "no-store"
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setState("error");
        setMessage(data.error ?? "This verification link is invalid or expired.");
        return;
      }

      setState("success");
      setMessage(data.message ?? "Email verified. You can sign in now.");
    }

    void verify();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title={state === "loading" ? "Verifying email…" : state === "success" ? "Email verified" : "Verification failed"}
        description={
          state === "loading"
            ? "Hang tight while we confirm your email address."
            : state === "success"
              ? "Your email is confirmed. Sign in to continue."
              : "We could not verify this link."
        }
        tight
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <div className="coop-panel space-y-6 p-6">
          {state === "loading" ? (
            <p className="text-sm text-coop-muted">Confirming your email address…</p>
          ) : null}

          {state === "success" ? (
            <>
              <p className={authSuccessClassName}>{message}</p>
              <Button href="/login" className="w-full">
                Sign in
              </Button>
              <Button href={adminLoginUrl} external variant="secondary" className="w-full">
                Open admin portal
              </Button>
            </>
          ) : null}

          {state === "error" ? (
            <>
              <p className={authErrorClassName}>{message}</p>
              <p className="text-center text-sm text-coop-muted">
                Need a new link?{" "}
                <Link href="/signup/free" className="font-medium text-gray-900 hover:underline">
                  Create an account
                </Link>{" "}
                or{" "}
                <Link href="/login" className="font-medium text-gray-900 hover:underline">
                  sign in
                </Link>
                .
              </p>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
