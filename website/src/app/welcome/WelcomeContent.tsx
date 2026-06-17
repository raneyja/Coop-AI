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
  "Open the admin portal and sign in with the API key from your email.",
  "Connect GitHub, Slack, and other tools once for your whole org.",
  "Invite teammates from the Users page.",
  "Developers install Coop AI in VS Code and sign in."
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
      if (data.orgName) {
        setOrgName(data.orgName);
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
      <div className="coop-panel space-y-6 p-8">
        {state === "invalid" && (
          <p className="rounded-sm border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200">
            We couldn&apos;t verify this checkout link. If you just paid, check your email for the
            admin portal link or{" "}
            <Link href="/demo" className="text-coop-index hover:text-white">
              contact support
            </Link>
            .
          </p>
        )}

        {showProvisioning && (
          <p className="rounded-sm border border-coop-border/80 bg-coop-surface/50 px-4 py-3 text-sm leading-relaxed text-coop-muted">
            {state === "verifying"
              ? "Confirming your payment…"
              : "Your organization is being set up. This usually takes less than a minute."}
            {orgName ? (
              <>
                {" "}
                <span className="text-white/90">{orgName}</span> will be ready shortly.
              </>
            ) : null}
          </p>
        )}

        {state === "ready" && orgName && (
          <p className="rounded-sm border border-coop-index/30 bg-coop-index/10 px-4 py-3 text-sm text-white/90">
            <strong>{orgName}</strong> is ready. Check your email for your admin API key.
          </p>
        )}

        <div>
          <h2 className="text-sm font-medium text-white">Next steps</h2>
          <ol className="mt-4 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm text-coop-muted">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-coop-border font-mono text-xs text-coop-index"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4 border-t border-coop-border pt-6">
          <Button href={adminPortalLoginUrl} external className="w-full">
            Open admin portal
          </Button>
          {showProvisioning && (
            <p className="text-center text-xs text-coop-muted">
              You can open the portal now — sign in once your API key email arrives.
            </p>
          )}
          <p className="text-center text-xs leading-relaxed text-coop-muted">
            Didn&apos;t get the email? Check spam or{" "}
            <Link href="/demo" className="text-coop-index hover:text-white">
              contact support
            </Link>
            .{" "}
            <Link href="/docs" className="text-coop-index hover:text-white">
              Install guide
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
