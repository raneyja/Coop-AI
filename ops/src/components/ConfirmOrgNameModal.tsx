"use client";

import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";

export type ConfirmOrgNameResult = {
  continueBilling?: boolean;
};

type ConfirmOrgNameModalProps = {
  open: boolean;
  title: string;
  orgName: string;
  description: string;
  confirmLabel: string;
  dismissLabel?: string;
  askContinueBilling?: boolean;
  onConfirm: (result: ConfirmOrgNameResult) => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
};

export function ConfirmOrgNameModal({
  open,
  title,
  orgName,
  description,
  confirmLabel,
  dismissLabel = "Go back",
  askContinueBilling = false,
  onConfirm,
  onClose,
  loading = false
}: ConfirmOrgNameModalProps) {
  const [typed, setTyped] = useState("");
  const [continueBilling, setContinueBilling] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setContinueBilling(null);
    }
  }, [open]);

  function handleClose() {
    setTyped("");
    setContinueBilling(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (typed.trim() !== orgName.trim()) return;
    if (askContinueBilling && continueBilling === null) return;
    await onConfirm(askContinueBilling ? { continueBilling: continueBilling === true } : {});
    setTyped("");
    setContinueBilling(null);
  }

  const matches = typed.trim() === orgName.trim();
  const canSubmit = matches && (!askContinueBilling || continueBilling !== null);

  return (
    <Modal open={open} title={title} onClose={handleClose}>
      <p className="mb-4 text-sm text-coop-muted">{description}</p>
      <p className="mb-2 text-sm">
        Type <strong className="font-mono text-white">{orgName}</strong> to confirm:
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          className="admin-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={orgName}
          autoComplete="off"
          disabled={loading}
        />
        {askContinueBilling && (
          <fieldset className="rounded-md border border-coop-border/60 p-3">
            <legend className="mb-2 text-sm text-white">Keep billing this customer in Stripe?</legend>
            <p className="mb-3 text-xs text-coop-muted">
              Yes keeps charges going. No pauses Stripe until you activate them again.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="continue-billing"
                  checked={continueBilling === true}
                  onChange={() => setContinueBilling(true)}
                  disabled={loading}
                />
                Yes, keep billing
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="continue-billing"
                  checked={continueBilling === false}
                  onChange={() => setContinueBilling(false)}
                  disabled={loading}
                />
                No, pause billing
              </label>
            </div>
          </fieldset>
        )}
        <div className="flex gap-2">
          <button type="button" className="admin-btn-secondary flex-1" onClick={handleClose} disabled={loading}>
            {dismissLabel}
          </button>
          <button
            type="submit"
            className="admin-btn-danger flex-1"
            disabled={!canSubmit || loading}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
