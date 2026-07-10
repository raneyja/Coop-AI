"use client";

import { FormEvent, useState } from "react";
import { Modal } from "./Modal";

type ConfirmOrgNameModalProps = {
  open: boolean;
  title: string;
  orgName: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
};

export function ConfirmOrgNameModal({
  open,
  title,
  orgName,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  loading = false
}: ConfirmOrgNameModalProps) {
  const [typed, setTyped] = useState("");

  function handleClose() {
    setTyped("");
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (typed.trim() !== orgName.trim()) return;
    await onConfirm();
    setTyped("");
  }

  const matches = typed.trim() === orgName.trim();

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
        <div className="flex gap-2">
          <button type="button" className="admin-btn-secondary flex-1" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="submit"
            className="admin-btn-danger flex-1"
            disabled={!matches || loading}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
