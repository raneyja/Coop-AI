"use client";

import { FormEvent, useState } from "react";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import { submitEnterpriseUpgradeRequest } from "@/lib/coopApi";
import { Modal } from "./Modal";

type EnterpriseUpgradeRequestFormProps = {
  open: boolean;
  onClose: () => void;
};

export function EnterpriseUpgradeRequestForm({ open, onClose }: EnterpriseUpgradeRequestFormProps) {
  const me = getStoredMe();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await submitEnterpriseUpgradeRequest({
      name: name.trim(),
      email: email.trim(),
      orgName: displayOrgName(me),
      notes: notes.trim() || undefined
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not submit request.");
      return;
    }
    setSent(true);
  }

  function handleClose() {
    setSent(false);
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} title="Request Enterprise upgrade" onClose={handleClose}>
      {sent ? (
        <div className="space-y-3 text-sm text-coop-muted">
          <p className="text-white">Thanks — our team will reach out shortly.</p>
          <button type="button" className="admin-btn-primary" onClick={handleClose}>
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <p className="text-sm text-coop-muted">
            Enterprise adds SAML SSO, integration scope controls, and uncapped org indexing. Tell us about your team and
            we&apos;ll follow up.
          </p>
          <div>
            <label htmlFor="enterprise-name" className="admin-label">
              Your name
            </label>
            <input
              id="enterprise-name"
              className="admin-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="enterprise-email" className="admin-label">
              Work email
            </label>
            <input
              id="enterprise-email"
              type="email"
              className="admin-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="enterprise-notes" className="admin-label">
              Notes (optional)
            </label>
            <textarea
              id="enterprise-notes"
              className="admin-input min-h-[96px]"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Team size, SSO provider, compliance needs…"
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="admin-btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="admin-btn-primary" disabled={submitting}>
              {submitting ? "Sending…" : "Submit request"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
