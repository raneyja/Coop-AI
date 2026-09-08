"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";

type CheckoutState = "idle" | "verifying" | "pending" | "ready" | "invalid";

type WelcomeContentProps = {
  sessionId?: string;
  fallbackAdminPortalLoginUrl: string;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

export function WelcomeContent({ sessionId, fallbackAdminPortalLoginUrl }: WelcomeContentProps) {
  const [state, setState] = useState<CheckoutState>(sessionId ? "verifying" : "idle");
  const [adminPortalLoginUrl, setAdminPortalLoginUrl] = useState(fallbackAdminPortalLoginUrl);
  const [orgName, setOrgName] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const checkoutSessionId = sessionId;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function checkStatus() {
      const response = await fetch(
        `/api/checkout-status?session_id=${encodeURIComponent(checkoutSessionId)}`,
        { cache: "no-store" }
      );
      const data = (await response.json().catch(() => ({}))) as {
        status?: string;
        orgName?: string;
        adminPortalLoginUrl?: string;
      };

      if (cancelled) {
        return;
      }

      if (data.adminPortalLoginUrl) {
        setAdminPortalLoginUrl(data.adminPortalLoginUrl);
      }
      const nextOrgName = data.orgName?.trim();
      if (nextOrgName) {
        setOrgName(nextOrgName);
      }

      if (!response.ok || data.status === "invalid") {
        setState("invalid");
        return;
      }

      if (data.status === "ready") {
        setState("ready");
        return;
      }

      setState("pending");
      attempts += 1;
      if (attempts < MAX_POLL_ATTEMPTS) {
        timer = setTimeout(checkStatus, POLL_INTERVAL_MS);
      }
    }

    void checkStatus();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [sessionId]);

  const showProvisioning = state === "verifying" || state === "pending";
  const showSignIn = state === "ready" || state === "idle" || state === "pending";

  return (
    <section className="mx-auto max-w-lg px-6 pb-24">
      <div className="coop-panel space-y-6 p-6 md:p-8">
        {state === "invalid" ? (
          <div className="border-l-2 border-l-red-500 pl-4">
            <p className="text-sm font-medium text-gray-900">We couldn&apos;t verify this checkout</p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              If you just paid, check your email for Activate your account, or contact support.
            </p>
          </div>
        ) : null}

        {showProvisioning ? (
          <div className="border-l-2 border-l-coop-index pl-4">
            <p className="text-sm font-medium text-gray-900">
              {state === "verifying" ? "Confirming your payment…" : "Setting up your workspace…"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              {orgName
                ? `${orgName} will be ready shortly: usually under a minute.`
                : "This usually takes less than a minute."}
            </p>
          </div>
        ) : null}

        {state === "ready" ? (
          <div className="border-l-2 border-l-coop-index pl-4">
            <p className="text-sm font-medium text-gray-900">
              {orgName ? `${orgName} is ready` : "Your workspace is ready"}
            </p>
          </div>
        ) : null}

        {showSignIn ? (
          <p className="text-center text-sm leading-relaxed text-coop-muted">
            Already activated?{" "}
            <a
              href={adminPortalLoginUrl}
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Sign in
            </a>
          </p>
        ) : null}

        {state === "invalid" ? (
          <Button href="/demo" variant="primary" className="w-full">
            Contact support
          </Button>
        ) : null}

        <p className="text-center text-xs leading-relaxed text-coop-muted">
          Didn&apos;t get the email? Check spam or{" "}
          <Link href="/demo" className="font-medium text-gray-900 underline-offset-2 hover:underline">
            contact support
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
