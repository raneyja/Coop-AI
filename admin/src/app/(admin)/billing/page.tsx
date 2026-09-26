"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStoredMe, displayOrgName } from "@/lib/auth";
import {
  createSeatIncreaseSession,
  createUpgradeCheckoutSession,
  fetchBilling,
  openBillingPortal,
  updateBillingEmail
} from "@/lib/coopApi";
import {
  addSeatsCopy,
  billingPageSubtitle,
  billingPlanDetailLine,
  billingPlanLabel,
  billingSeatBreakdown,
  billingStatusDisplay,
  isSoloSeatCount,
  newSeatTotalPreview,
  normalizeSeatCount,
  seatMixLine,
  seatPriceLabel,
  upgradeSeatCountNote
} from "@/lib/billingCopy";
import { EnterpriseUpgradeRequestForm } from "@/components/EnterpriseUpgradeRequestForm";
import { PlanBadge } from "@/components/PlanBadge";
import { SettingsRow } from "@/components/SettingsRow";
import { StatusBadge } from "@/components/StatusBadge";
import { UpgradeCTA } from "@/components/UpgradeCTA";
import { displayUsageTierName, resolvePlanNudge } from "@/lib/planNudge";

export default function BillingPage() {
  const me = getStoredMe();
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof fetchBilling>>["data"]>();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  const [enterpriseFormOpen, setEnterpriseFormOpen] = useState(false);
  const [seatInput, setSeatInput] = useState("1");
  const [addTier, setAddTier] = useState<"pro" | "pro_plus" | "max">("pro");
  const [addingSeats, setAddingSeats] = useState(false);
  const [billingEmailDraft, setBillingEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchBilling();
    setLoading(false);
    if (result.ok) {
      setBilling(result.data);
      setBillingEmailDraft(result.data?.billingEmail ?? "");
      return;
    }
    setError(result.error ?? "Could not load billing.");
  }, []);

  useEffect(() => {
    void load();
    if (typeof window !== "undefined") {
      setUpgraded(new URLSearchParams(window.location.search).get("upgraded") === "1");
    }
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined" || loading) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id")?.trim() ?? "";
    const pendingRaw = sessionStorage.getItem("coop.upgradeCheckoutPending");
    const pendingAt = pendingRaw ? Number(pendingRaw) : 0;
    const pendingFresh =
      Number.isFinite(pendingAt) && pendingAt > 0 && Date.now() - pendingAt < 5 * 60_000;
    if (!sessionId && !pendingFresh) {
      return;
    }
    if (billing?.plan === "pro" || billing?.plan === "enterprise") {
      sessionStorage.removeItem("coop.upgradeCheckoutPending");
      setUpgraded(true);
      return;
    }
    if (billing?.plan && billing.plan !== "free") {
      return;
    }

    let cancelled = false;
    const started = Date.now();
    setConfirmingUpgrade(true);
    setError(null);

    const poll = async () => {
      while (!cancelled && Date.now() - started < 60_000) {
        const result = await fetchBilling();
        if (cancelled) {
          return;
        }
        if (result.ok && result.data) {
          setBilling(result.data);
          setBillingEmailDraft(result.data.billingEmail ?? "");
          if (result.data.plan === "pro" || result.data.plan === "enterprise") {
            sessionStorage.removeItem("coop.upgradeCheckoutPending");
            setConfirmingUpgrade(false);
            setUpgraded(true);
            return;
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      if (!cancelled) {
        setConfirmingUpgrade(false);
        sessionStorage.removeItem("coop.upgradeCheckoutPending");
        setError(
          "Still confirming your upgrade. Refresh in a minute — do not start a second checkout with the same email."
        );
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [loading, billing?.plan]);

  useEffect(() => {
    if (billing?.usageTier === "pro" || billing?.usageTier === "pro_plus" || billing?.usageTier === "max") {
      setAddTier(billing.usageTier);
    }
  }, [billing?.usageTier]);

  async function handlePortal() {
    setOpening(true);
    setError(null);
    const result = await openBillingPortal();
    setOpening(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not open billing portal.");
      return;
    }
    window.location.href = result.data.url;
  }

  async function handleUpgrade() {
    setUpgrading(true);
    setError(null);
    const result = await createUpgradeCheckoutSession();
    setUpgrading(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not start checkout.");
      return;
    }
    try {
      sessionStorage.setItem("coop.upgradeCheckoutPending", String(Date.now()));
    } catch {
      // Ignore quota / private mode.
    }
    window.location.href = result.data.url;
  }

  async function handleAddSeats() {
    setError(null);
    const addSeats = Math.floor(Number(seatInput));
    if (!Number.isFinite(addSeats) || addSeats < 1) {
      setError("Enter how many seats to add (at least 1).");
      return;
    }
    setAddingSeats(true);
    const result = await createSeatIncreaseSession(addSeats, addTier);
    setAddingSeats(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not start seat increase.");
      return;
    }
    window.location.href = result.data.url;
  }

  async function handleBillingEmailSave() {
    const email = billingEmailDraft.trim().toLowerCase();
    if (!email || email === (billing?.billingEmail ?? "").trim().toLowerCase()) {
      return;
    }
    setSavingEmail(true);
    setError(null);
    const result = await updateBillingEmail(email);
    setSavingEmail(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update billing email.");
      return;
    }
    setBilling((current) =>
      current
        ? {
            ...current,
            billingEmail: result.data?.billingEmail ?? email,
            billingEmailOptions: result.data?.billingEmailOptions ?? current.billingEmailOptions
          }
        : current
    );
    setBillingEmailDraft(result.data?.billingEmail ?? email);
  }

  const plan = billing?.plan ?? me?.plan ?? "free";
  const usageTier = billing?.usageTier ?? (plan === "pro" ? "pro" : null);
  const currentSeats = normalizeSeatCount(billing?.seats);
  const solo = Boolean(billing) && isSoloSeatCount(currentSeats);
  const mixed = Boolean(billing?.mixedSeats);
  const mixLine = seatMixLine(billing?.seatMix);
  const seatRows = billingSeatBreakdown(billing?.seatInventory);
  const status = billingStatusDisplay(billing?.status);
  const nudge = resolvePlanNudge({
    plan,
    usageTier,
    seats: billing ? currentSeats : null
  });
  const isFree = plan === "free";
  const isPro = plan === "pro";
  const isEnterprise = plan === "enterprise";
  const addCount = Math.floor(Number(seatInput));
  const seatsCopy = addSeatsCopy({ solo, currentSeats, addCount });
  const totalPreview = newSeatTotalPreview(currentSeats, addCount);
  const currentPlanName = billingPlanLabel({
    plan,
    usageTier,
    seats: billing ? currentSeats : null
  });
  const planDetail = billing
    ? billingPlanDetailLine({
        solo: solo || isFree,
        seats: currentSeats,
        mixLine,
        usageTierName: displayUsageTierName(
          usageTier === "pro_plus" || usageTier === "max" ? usageTier : "pro"
        )
      })
    : null;
  const paidNextIsEnterprise = nudge?.nextName === "Enterprise";
  const hasStripe = Boolean(billing?.hasStripeCustomer);
  const billingReady = Boolean(billing) && !loading;
  const showPlanNudge = billingReady && Boolean(nudge) && !mixed && !isEnterprise && !isFree;
  const orgName = displayOrgName(me);
  const billingEmailOptions = billing?.billingEmailOptions ?? [];
  const billingEmailDirty =
    billingEmailDraft.trim().toLowerCase() !== (billing?.billingEmail ?? "").trim().toLowerCase();

  const addSeatsForm = isPro ? (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-white">{seatsCopy.title}</p>
        <p className="mt-1 text-sm text-coop-muted">{seatsCopy.body}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[8rem] flex-col gap-1 text-sm">
          <span className="text-coop-muted">Plan</span>
          <select
            className="admin-input"
            value={addTier}
            onChange={(event) => setAddTier(event.target.value as "pro" | "pro_plus" | "max")}
            disabled={addingSeats}
          >
            <option value="pro">Pro · {seatPriceLabel("pro")}</option>
            <option value="pro_plus">Pro+ · {seatPriceLabel("pro_plus")}</option>
            <option value="max">Max · {seatPriceLabel("max")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-coop-muted">{seatsCopy.inputLabel}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="admin-input w-[7.5rem]"
            value={seatInput}
            onChange={(event) => setSeatInput(event.target.value)}
            disabled={addingSeats}
          />
        </label>
        <button
          type="button"
          className="admin-btn-primary"
          onClick={() => void handleAddSeats()}
          disabled={addingSeats}
        >
          {addingSeats ? "Opening…" : seatsCopy.cta}
        </button>
      </div>
      {totalPreview ? <p className="text-xs text-coop-muted">{totalPreview}</p> : null}
      {seatsCopy.showReduceNote ? (
        <p className="text-xs text-coop-muted">
          To reduce seats, email{" "}
          <a href="mailto:support@coop-ai.dev" className="admin-link">
            support@coop-ai.dev
          </a>
          .
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Billing</h1>
          <p className="mt-1 text-sm text-coop-muted">
            {billing ? billingPageSubtitle(solo || isFree) : "Your plan and payment."}
          </p>
        </div>
        {isFree ? (
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => void handleUpgrade()}
            disabled={upgrading || confirmingUpgrade}
          >
            {confirmingUpgrade ? "Confirming upgrade…" : upgrading ? "Redirecting…" : "Upgrade to Pro"}
          </button>
        ) : null}
      </div>

      {confirmingUpgrade ? (
        <div className="admin-panel-inset text-sm text-coop-muted" role="status">
          Confirming upgrade… Finish Stripe Checkout, then return here. This usually takes a few seconds.
        </div>
      ) : null}

      {upgraded ? (
        <div className="admin-panel-inset text-sm text-coop-index">
          Upgrade complete — this organization is now on {currentPlanName}.
        </div>
      ) : null}

      {showPlanNudge && nudge ? (
        <div className="space-y-2">
          <UpgradeCTA
            variant="banner"
            tone="plan"
            title={nudge.title}
            body={nudge.body}
            ctaLabel={nudge.ctaLabel}
            onAction={
              paidNextIsEnterprise ? () => setEnterpriseFormOpen(true) : () => void handlePortal()
            }
            actionLoading={opening}
          />
          {!paidNextIsEnterprise ? (
            <p className="text-xs text-coop-muted">{upgradeSeatCountNote(solo, nudge.nextName)}</p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <section className="admin-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="admin-section-label">Plan</h2>
            <p className="mt-3 text-lg font-semibold tracking-tight text-white">
              {loading ? "…" : currentPlanName}
            </p>
            {planDetail && seatRows.length === 0 ? (
              <p className="mt-1 text-sm text-coop-muted">{planDetail}</p>
            ) : null}
            {isFree && !loading ? (
              <p className="mt-1 text-sm text-coop-muted">
                Upgrade to Pro for unlimited Deep-Indexed repos, additional models, and the option to
                add team seats.
              </p>
            ) : null}
          </div>
          {!loading ? <PlanBadge plan={plan} usageTier={usageTier} seats={currentSeats} /> : null}
        </div>

        <dl className="mt-4">
          <SettingsRow label="Organization">{orgName}</SettingsRow>
          {!loading && billing ? (
            <SettingsRow label="Status">
              <div className="space-y-1">
                <StatusBadge
                  connected={status.tone === "connected"}
                  showWhenDisconnected
                  tone={status.tone}
                  label={status.label}
                />
                {status.hint ? <p className="text-xs text-coop-muted">{status.hint}</p> : null}
              </div>
            </SettingsRow>
          ) : null}
          {!loading && billing ? (
            <SettingsRow label="Billing email">
              {billingEmailOptions.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="admin-input max-w-xs"
                    value={billingEmailDraft}
                    onChange={(event) => setBillingEmailDraft(event.target.value)}
                    disabled={savingEmail}
                  >
                    {billingEmailOptions.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="admin-btn-secondary"
                    onClick={() => void handleBillingEmailSave()}
                    disabled={savingEmail || !billingEmailDirty}
                  >
                    {savingEmail ? "Saving…" : "Update"}
                  </button>
                </div>
              ) : (
                <span>{billing.billingEmail ?? (billingEmailDraft || "—")}</span>
              )}
            </SettingsRow>
          ) : null}
        </dl>
      </section>

      {isPro ? (
        <section className="admin-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="admin-section-label">{solo ? "Account" : "Seats"}</h2>
              {solo ? (
                <p className="mt-3 text-sm text-white">Just you</p>
              ) : (
                <p className="mt-3 text-2xl font-semibold tabular-nums text-white">{currentSeats}</p>
              )}
            </div>
            <Link href="/users" className="admin-link text-sm">
              Manage people →
            </Link>
          </div>

          {seatRows.length > 0 ? (
            <dl className="mt-4">
              {seatRows.map((row) => (
                <SettingsRow key={row.tier} label={row.name}>
                  <span className="tabular-nums">
                    {row.count} {row.count === 1 ? "seat" : "seats"} · {seatPriceLabel(row.tier)}
                  </span>
                </SettingsRow>
              ))}
            </dl>
          ) : null}

          {addSeatsForm ? (
            <div className="border-t border-coop-border/30 pt-6">{addSeatsForm}</div>
          ) : null}
        </section>
      ) : null}

      {hasStripe ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Payment</h2>
          <p className="mt-3 text-sm text-coop-muted">
            Cards, invoices, and cancellation are managed in Stripe.
          </p>
          <dl className="mt-4">
            <SettingsRow label="Stripe">
              <button
                type="button"
                className="admin-link text-sm"
                onClick={() => void handlePortal()}
                disabled={opening}
              >
                {opening ? "Opening…" : "Manage payment & invoices →"}
              </button>
            </SettingsRow>
            {isPro && !paidNextIsEnterprise ? (
              <SettingsRow label="Enterprise">
                <button
                  type="button"
                  className="admin-link text-sm"
                  onClick={() => setEnterpriseFormOpen(true)}
                >
                  Request a custom contract →
                </button>
              </SettingsRow>
            ) : null}
          </dl>
        </section>
      ) : isPro ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Payment</h2>
          <p className="mt-3 text-sm text-coop-muted">
            No Stripe subscription is on file for this organization. Purchase Pro at{" "}
            <a href="https://coop-ai.dev/signup" className="admin-link">
              coop-ai.dev/signup
            </a>
            .
          </p>
        </section>
      ) : isEnterprise ? (
        <section className="admin-card">
          <h2 className="admin-section-label">Payment</h2>
          <p className="mt-3 text-sm text-coop-muted">
            Enterprise billing is managed with Coop. For contract changes, email{" "}
            <a href="mailto:support@coop-ai.dev" className="admin-link">
              support@coop-ai.dev
            </a>
            .
          </p>
        </section>
      ) : null}

      <EnterpriseUpgradeRequestForm open={enterpriseFormOpen} onClose={() => setEnterpriseFormOpen(false)} />
    </div>
  );
}
