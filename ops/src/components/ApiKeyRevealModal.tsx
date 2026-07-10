"use client";

import { useState } from "react";
import { Modal } from "./Modal";

type ApiKeyRevealModalProps = {
  open: boolean;
  rawKey: string;
  label: string;
  onClose: () => void;
};

export function ApiKeyRevealModal({ open, rawKey, label, onClose }: ApiKeyRevealModalProps) {
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} title="API key created" onClose={onClose}>
      <p className="mb-2 text-sm text-coop-muted">
        Copy this key now — you won&apos;t be able to see it again.
      </p>
      <div className="admin-panel-inset mb-4 space-y-2 text-sm">
        <p>
          <strong className="text-white">Extension API key</strong> — paste into VS Code under Coop
          settings. Used by developers for autocomplete, chat, and indexing in the IDE.
        </p>
        <p>
          <strong className="text-white">Admin portal login</strong> — separate from this key. The
          customer admin signs in at admin.coop-ai.dev with email/password or Google; do not share
          this API key as a login credential.
        </p>
      </div>
      <p className="admin-label">Label: {label}</p>
      <div className="flex gap-2">
        <code className="flex-1 break-all rounded-sm border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
          {rawKey}
        </code>
        <button type="button" className="admin-btn-secondary shrink-0" onClick={copyKey}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button type="button" className="admin-btn-primary mt-4 w-full" onClick={onClose}>
        Done — I saved the key
      </button>
    </Modal>
  );
}
