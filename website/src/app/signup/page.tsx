"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { AuthDivider, GoogleAuthButton } from "@/components/AuthForm";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tierParam = searchParams.get("tier");
  const tier =
    tierParam === "pro_plus" || tierParam === "max" || tierParam === "pro" ? tierParam : "pro";
  const planLabel = tier === "pro_plus" ? "Pro+" : tier === "max" ? "Max" : "Pro";
  const forTeam = searchParams.get("for") === "team";
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [seats, setSeats] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);

  useEffect(() => {
    const code = searchParams.get("error")?.trim() ?? "";
    const oauthMessage = searchParams.get("message")?.trim();
    if (!code && !oauthMessage) {
      return;
    }
    setError(
      oauthMessage ||
        (code === "account_exists"
          ? "This Google account already has a CoopAI account. Sign in and upgrade from Billing."
          : code)
    );
    setAccountExists(code === "account_exists");
  }, [searchParams]);

  function switchMode(nextForTeam: boolean) {
    setError(null);
    setAccountExists(false);
    const params = new URLSearchParams(searchParams.toString());
    if (nextForTeam) {
      params.set("for", "team");
    } else {
      params.delete("for");
    }
    params.delete("error");
    params.delete("message");
    const qs = params.toString();
    router.replace(qs ? `/signup?${qs}` : "/signup", { scroll: false });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAccountExists(false);

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        forTeam
          ? { orgName: orgName.trim(), email: email.trim(), seats, tier, intent: "team" }
          : { email: email.trim(), tier, intent: "individual" }
      )
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    setLoading(false);

    if (!response.ok || !data.url) {
      const message = data.error ?? "Could not start checkout. Try again or book a demo.";
      setError(message);
      setAccountExists(response.status === 409 || /already has a CoopAI account/i.test(message));
      return;
    }

    window.location.href = data.url;
  }

  const inputClassName =
    "w-full rounded-md border border-coop-border bg-white px-3 py-2 text-gray-900 placeholder:text-coop-muted/60 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300";
  const googleDisabled = loading || (forTeam && !orgName.trim());

  return (
    <>
      <PageHeader
        eyebrow={forTeam ? "Team" : "For you"}
        title={forTeam ? `Start ${planLabel} for your team` : `Start ${planLabel}`}
        description={
          forTeam
            ? "You're the admin. Name the organization, pick seats, pay via Stripe, then invite teammates."
            : "Pay via Stripe. You're the admin of your own workspace — no seats to choose."
        }
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-coop-border bg-coop-surface p-6">
          {error ? (
            <p className="text-sm text-red-600">
              {error}
              {accountExists ? (
                <>
                  {" "}
                  <Link href="/login" className="font-medium text-gray-900 hover:underline">
                    Sign in
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {forTeam ? (
            <div>
              <label htmlFor="orgName" className="mb-1 block text-sm text-coop-muted">
                Organization name
              </label>
              <input
                id="orgName"
                className={inputClassName}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </div>
          ) : null}
          {forTeam ? (
            <div>
              <label htmlFor="seats" className="mb-1 block text-sm text-coop-muted">
                Seats
              </label>
              <input
                id="seats"
                type="number"
                min={2}
                className={inputClassName}
                value={seats}
                onChange={(e) => setSeats(Math.max(2, Number(e.target.value) || 2))}
                required
              />
              <p className="mt-1 text-xs text-coop-muted">
                Includes you. You can add more later from Billing.
              </p>
            </div>
          ) : null}

          <GoogleAuthButton
            mode="checkout"
            orgName={forTeam ? orgName : undefined}
            disabled={googleDisabled}
            checkout={{
              tier,
              intent: forTeam ? "team" : "individual",
              seats: forTeam ? seats : 1
            }}
          />

          <AuthDivider />

          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-coop-muted">
              Your email
            </label>
            <input
              id="email"
              type="email"
              className={inputClassName}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {forTeam ? (
              <p className="mt-1 text-xs text-coop-muted">
                Use your own email. You&apos;ll be the admin and invite the rest after checkout.
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-white hover:bg-[#46c35a] disabled:opacity-50"
          >
            {loading ? "Redirecting to Stripe…" : "Continue to checkout"}
          </button>
          <p className="text-center text-sm text-coop-muted">
            {forTeam ? (
              <>
                Just yourself?{" "}
                <button
                  type="button"
                  className="font-medium text-gray-900 hover:underline"
                  onClick={() => switchMode(false)}
                >
                  Start {planLabel} as an individual
                </button>
              </>
            ) : (
              <>
                Buying seats for a team?{" "}
                <button
                  type="button"
                  className="font-medium text-gray-900 hover:underline"
                  onClick={() => switchMode(true)}
                >
                  Start a team
                </button>
              </>
            )}
          </p>
          <p className="text-center text-sm text-coop-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-gray-900 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </section>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
