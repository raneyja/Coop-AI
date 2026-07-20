"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";

type CheckoutState = "idle" | "verifying" | "pending" | "ready" | "invalid";

type WelcomeContentProps = {
  sessionId?: string;
  fallbackAdminPortalLoginUrl: string;
};

const STEPS = [
  "Open the admin portal and sign in with Google, or set a password via Forgot password.",
  "Connect GitHub, Slack, and other tools once for your whole org.",
  "Invite teammates from the Users page.",
  "Developers install the CoopAI VS Code extension and sign in."
] as const;

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

  return (
    <section className="mx-auto max-w-lg px-6 pb-24">
      <div className="coop-panel space-y-8 p-6 md:p-8">
        {state === "invalid" ? (
          <div className="border-l-2 border-l-red-500 pl-4">
            <p className="text-sm font-medium text-gray-900">We couldn&apos;t verify this checkout</p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              If you just paid, check your email for the admin portal link or{" "}
              <Link href="/demo" className="font-medium text-gray-900 underline-offset-2 hover:underline">
                contact support
              </Link>
              .
            </p>
          </div>
        ) : null}

        {showProvisioning ? (
          <div className="border-l-2 border-l-coop-index pl-4">
            <p className="text-sm font-medium text-gray-900">
              {state === "verifying" ? "Confirming your payment…" : "Setting up your organization…"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              {orgName
                ? `${orgName} will be ready shortly — usually under a minute.`
                : "This usually takes less than a minute."}
            </p>
          </div>
        ) : null}

        {state === "ready" ? (
          <div className="border-l-2 border-l-coop-index pl-4">
            <p className="text-sm font-medium text-gray-900">
              {orgName ? `${orgName} is ready` : "Your organization is ready"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-coop-muted">
              Sign in with Google, or use Forgot password to set a password for this email.
            </p>
          </div>
        ) : null}

        <div>
          <h2 className="text-sm font-semibold text-gray-900">Next steps</h2>
          <ol className="mt-4 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-coop-border font-mono text-xs text-coop-index"
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-3 border-t border-coop-border pt-6">
          <Button href={adminPortalLoginUrl} external className="w-full">
            Open admin portal
          </Button>
          {showProvisioning ? (
            <p className="text-center text-xs leading-relaxed text-coop-muted">
              You can open the portal now — sign in once provisioning finishes.
            </p>
          ) : null}
          <p className="text-center text-xs leading-relaxed text-coop-muted">
            Didn&apos;t get the email? Check spam or{" "}
            <Link href="/demo" className="font-medium text-gray-900 underline-offset-2 hover:underline">
              contact support
            </Link>
            .{" "}
            <Link
              href="/manual#get-started"
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
            >
              Owner&apos;s Manual
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
