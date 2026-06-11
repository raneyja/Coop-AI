"use client";

import { FormEvent, useState } from "react";
import { PageHeader } from "@/components/PageHeader";

export default function SignupPage() {
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [seats, setSeats] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: orgName.trim(), email: email.trim(), seats })
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    setLoading(false);

    if (!response.ok || !data.url) {
      setError(data.error ?? "Could not start checkout. Try again or book a demo.");
      return;
    }

    window.location.href = data.url;
  }

  return (
    <>
      <PageHeader
        title="Start Pro"
        description="Create your organization, pay via Stripe, and get your admin portal link by email."
      />

      <section className="mx-auto max-w-lg px-6 pb-24">
        <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-coop-border bg-coop-surface p-6">
          <div>
            <label htmlFor="orgName" className="mb-1 block text-sm text-coop-muted">
              Organization name
            </label>
            <input
              id="orgName"
              className="w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 text-white"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-coop-muted">
              Admin email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 text-white"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="seats" className="mb-1 block text-sm text-coop-muted">
              Seats
            </label>
            <input
              id="seats"
              type="number"
              min={1}
              className="w-full rounded-md border border-coop-border bg-coop-dark px-3 py-2 text-white"
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value) || 1)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-sm bg-coop-index px-4 py-2 text-sm font-medium text-coop-dark hover:bg-[#46c35a] disabled:opacity-50"
          >
            {loading ? "Redirecting to Stripe…" : "Continue to checkout"}
          </button>
        </form>
      </section>
    </>
  );
}
