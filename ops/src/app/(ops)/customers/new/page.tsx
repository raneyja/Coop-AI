"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredMe } from "@/lib/auth";
import { canMutateBilling } from "@/lib/operatorRbac";
import {
  provisionOrganization,
  type OrgPlan,
  type ProvisionCustomerResult
} from "@/lib/coopApi";
import { ApiKeyRevealModal } from "@/components/ApiKeyRevealModal";
import { UnavailableBanner } from "@/components/UnavailableBanner";

const STEPS = ["Organization", "Plan & seats", "Admin invite", "Review"] as const;

export default function ProvisionCustomerPage() {
  const router = useRouter();
  const me = getStoredMe();
  const canProvision = me ? canMutateBilling(me) : false;

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<OrgPlan>("enterprise");
  const [seats, setSeats] = useState("10");
  const [adminEmail, setAdminEmail] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [crmExternalId, setCrmExternalId] = useState("");
  const [createBootstrapKey, setCreateBootstrapKey] = useState(false);
  const [bootstrapKeyLabel, setBootstrapKeyLabel] = useState("Bootstrap key");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [result, setResult] = useState<ProvisionCustomerResult | null>(null);
  const [keyModal, setKeyModal] = useState<{ rawKey: string; label: string } | null>(null);

  function canAdvance(): boolean {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) {
      if (plan === "free") return true;
      const seatNum = Number(seats);
      return Number.isFinite(seatNum) && seatNum >= 1;
    }
    if (step === 2) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim());
    return true;
  }

  function nextStep() {
    if (!canAdvance()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function prevStep() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canProvision) {
      setError("Billing or super-admin role required to provision customers.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const seatNum = plan === "free" ? undefined : Number(seats);
    const response = await provisionOrganization({
      name: name.trim(),
      plan,
      seats: seatNum,
      adminEmail: adminEmail.trim().toLowerCase(),
      sendInvite: true,
      createBootstrapKey,
      bootstrapKeyLabel: createBootstrapKey ? bootstrapKeyLabel.trim() || "Bootstrap key" : undefined,
      operatorNotes: operatorNotes.trim() || undefined,
      crmExternalId: crmExternalId.trim() || undefined
    });
    setSubmitting(false);

    if (response.unavailable) {
      setUnavailable(true);
      return;
    }
    if (!response.ok || !response.data) {
      setError(response.error ?? "Failed to provision customer.");
      return;
    }

    setResult(response.data);
    if (response.data.bootstrapKey?.rawKey) {
      setKeyModal({
        rawKey: response.data.bootstrapKey.rawKey,
        label: response.data.bootstrapKey.label
      });
    }
  }

  if (!canProvision) {
    return (
      <div className="space-y-4">
        <h1 className="admin-page-title">Provision customer</h1>
        <p className="text-sm text-coop-muted">
          Your role ({me?.role ?? "unknown"}) cannot provision customers. Billing or super-admin access
          is required.
        </p>
        <Link href="/customers" className="admin-btn-secondary inline-flex">
          Back to customers
        </Link>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="admin-page-title">Customer provisioned</h1>
        <div className="admin-panel-inset space-y-2 text-sm">
          <p>
            <strong className="text-white">{result.organization.name}</strong> created on{" "}
            {plan} plan.
          </p>
          {result.invite ? (
            <p>
              Admin invite sent to <span className="font-mono">{result.invite.email}</span>
              {result.invite.inviteLink ? (
                <>
                  {" "}
                  —{" "}
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => navigator.clipboard.writeText(result.invite!.inviteLink!)}
                  >
                    Copy invite link
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => router.push(`/customers/${result.organization.id}`)}
          >
            Open customer detail
          </button>
          <Link href="/customers" className="admin-btn-secondary">
            Back to list
          </Link>
        </div>
        <ApiKeyRevealModal
          open={Boolean(keyModal)}
          rawKey={keyModal?.rawKey ?? ""}
          label={keyModal?.label ?? ""}
          onClose={() => setKeyModal(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="admin-page-title">Provision customer</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Create a hosted organization, send the admin invite, and optionally deliver a bootstrap API key.
        </p>
      </div>

      {unavailable && <UnavailableBanner />}

      <div className="flex gap-2">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={`flex-1 border-b-2 pb-2 text-center text-xs font-medium ${
              index === step
                ? "border-coop-index text-white"
                : index < step
                  ? "border-coop-index/40 text-coop-muted"
                  : "border-coop-border text-coop-muted/60"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <form onSubmit={step === STEPS.length - 1 ? handleSubmit : (e) => e.preventDefault()} className="space-y-6">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="orgName" className="admin-label">
                Organization name
              </label>
              <input
                id="orgName"
                type="text"
                className="admin-input"
                placeholder="Acme Engineering"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="crmId" className="admin-label">
                CRM external ID (optional)
              </label>
              <input
                id="crmId"
                type="text"
                className="admin-input"
                placeholder="hubspot:12345"
                value={crmExternalId}
                onChange={(e) => setCrmExternalId(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="notes" className="admin-label">
                Internal notes (optional)
              </label>
              <textarea
                id="notes"
                className="admin-input min-h-[80px]"
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="plan" className="admin-label">
                Plan
              </label>
              <select
                id="plan"
                className="admin-input"
                value={plan}
                onChange={(e) => setPlan(e.target.value as OrgPlan)}
              >
                <option value="enterprise">Enterprise</option>
                <option value="pro">Pro</option>
                <option value="free">Free</option>
              </select>
            </div>
            {plan !== "free" && (
              <div>
                <label htmlFor="seats" className="admin-label">
                  Seat limit
                </label>
                <input
                  id="seats"
                  type="number"
                  min={1}
                  className="admin-input"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="adminEmail" className="admin-label">
                Admin email (invite required)
              </label>
              <input
                id="adminEmail"
                type="email"
                className="admin-input"
                placeholder="admin@customer.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
              <p className="mt-2 text-xs text-coop-muted">
                An invite email will be sent. The admin completes setup in the customer admin portal —
                no password bootstrap.
              </p>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={createBootstrapKey}
                onChange={(e) => setCreateBootstrapKey(e.target.checked)}
                className="mt-1 rounded border-coop-border"
              />
              <span>
                <strong className="text-white">Optional:</strong> create a bootstrap extension API key
                after provisioning. Shown once in a secure modal — never logged or stored in notes.
              </span>
            </label>
            {createBootstrapKey && (
              <div>
                <label htmlFor="keyLabel" className="admin-label">
                  Bootstrap key label
                </label>
                <input
                  id="keyLabel"
                  type="text"
                  className="admin-input"
                  value={bootstrapKeyLabel}
                  onChange={(e) => setBootstrapKeyLabel(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="admin-panel-inset space-y-2 text-sm">
            <p>
              <span className="text-coop-muted">Organization:</span> {name}
            </p>
            <p>
              <span className="text-coop-muted">Plan:</span> {plan}
              {plan !== "free" ? ` · ${seats} seats` : ""}
            </p>
            <p>
              <span className="text-coop-muted">Admin invite:</span> {adminEmail}
            </p>
            {crmExternalId && (
              <p>
                <span className="text-coop-muted">CRM ID:</span> {crmExternalId}
              </p>
            )}
            {operatorNotes && (
              <p>
                <span className="text-coop-muted">Notes:</span> {operatorNotes}
              </p>
            )}
            {createBootstrapKey && (
              <p>
                <span className="text-coop-muted">Bootstrap key:</span> {bootstrapKeyLabel}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-between gap-3">
          {step > 0 ? (
            <button type="button" className="admin-btn-secondary" onClick={prevStep}>
              Back
            </button>
          ) : (
            <Link href="/customers" className="admin-btn-secondary">
              Cancel
            </Link>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="admin-btn-primary" onClick={nextStep} disabled={!canAdvance()}>
              Continue
            </button>
          ) : (
            <button type="submit" className="admin-btn-primary" disabled={submitting || unavailable}>
              {submitting ? "Provisioning…" : "Provision customer"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
