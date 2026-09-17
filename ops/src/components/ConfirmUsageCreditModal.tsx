"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatUsagePercent, type UsageCreditTargetRatio } from "@/lib/coopApi";
import { Modal } from "./Modal";

type ConfirmUsageCreditModalProps = {
  open: boolean;
  email: string;
  currentRatio: number | null;
  targetRatio: UsageCreditTargetRatio | null;
  loading?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
};

export function ConfirmUsageCreditModal({
  open,
  email,
  currentRatio,
  targetRatio,
  loading = false,
  onConfirm,
  onClose
}: ConfirmUsageCreditModalProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || targetRatio == null) return;
    await onConfirm(trimmed);
  }

  const percent = targetRatio == null ? "" : `${Math.round(targetRatio * 100)}%`;
  const canSubmit = reason.trim().length > 0 && targetRatio != null && !loading;

  return (
    <Modal open={open} title={`Set usage to ${percent || "…"}`} onClose={onClose}>
      <p className="mb-4 text-sm text-coop-muted">
        Credit <span className="font-mono text-white">{email}</span> from{" "}
        {formatUsagePercent(currentRatio)} to {percent || "—"}. Chat and the extension meter
        update on the next request.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="usage-credit-reason" className="admin-label">
            Reason
          </label>
          <input
            id="usage-credit-reason"
            type="text"
            className="admin-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this credit?"
            maxLength={500}
            autoComplete="off"
            disabled={loading}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className="admin-btn-secondary flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="admin-btn-primary flex-1" disabled={!canSubmit}>
            {loading ? "Crediting…" : `Set to ${percent || "…"}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
