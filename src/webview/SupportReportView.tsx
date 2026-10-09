import React, { useEffect, useRef, useState } from "react";
import { CoopPanelHeader } from "./components/CoopPanelHeader";
import { CoopNotice } from "./components/CoopNotice";
import { parseSupportSubmission, type SupportDiagnostics, type SupportKind } from "../support/supportTypes";

export function SupportReportView({ vscode }: { vscode: { postMessage: (message: unknown) => void } }): React.ReactElement {
  const [kind, setKind] = useState<SupportKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics>();
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const submission = useRef<{ snapshot: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "support:init") { setDiagnostics(message.payload.diagnostics); setContactEmail((value) => value || message.payload.contactEmail); }
      if (message.type === "support:error") { setError(message.payload.message); setSending(false); }
      if (message.type === "support:sent") { setReceipt(message.payload.id); setSending(false); }
    };
    window.addEventListener("message", receive);
    vscode.postMessage({ type: "support:ready" });
    return () => window.removeEventListener("message", receive);
  }, [vscode]);
  const close = () => vscode.postMessage({ type: "support:close" });
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const draft = { kind, title, description, contactEmail, ...(includeDiagnostics ? { diagnostics } : {}) };
    const snapshot = JSON.stringify(draft);
    if (submission.current?.snapshot !== snapshot) submission.current = { snapshot, id: crypto.randomUUID() };
    try {
      const payload = parseSupportSubmission({ ...draft, submissionId: submission.current.id });
      setError(""); setSending(true); vscode.postMessage({ type: "support:submit", payload });
    } catch (error) { setError((error as Error).message); }
  };
  return <div className="coop-panel coop-canvas-bg h-screen overflow-auto">
    <div className="coop-settings-shell max-w-[720px] mx-auto">
      <CoopPanelHeader title="Report an issue" subtitle="Send a bug report, feedback, or feature request to the CoopAI team." onClose={close} wrapSubtitle />
      <div className="coop-settings-body">
        {receipt ? <div className="coop-settings-card space-y-4" role="status">
          <h2 className="coop-settings-row-title">Report received</h2>
          <p>Our team can now review your report. We’ll contact you at {contactEmail} if we need more information.</p>
          <p className="coop-prompt-modal-muted break-all">Report ID: {receipt}</p>
          <button className="coop-settings-action-btn" onClick={close}>Close</button>
        </div> : <form onSubmit={send} className="coop-settings-card space-y-4">
          <fieldset disabled={sending} className="space-y-4 min-w-0">
            <label className="block coop-settings-row-title">Type
              <select className="coop-settings-field mt-2 w-full" value={kind} onChange={(e) => setKind(e.target.value as SupportKind)}>
                <option value="bug">Bug report</option><option value="feedback">Feedback</option><option value="feature_request">Feature request</option>
              </select>
            </label>
            <label className="block coop-settings-row-title">Contact email
              <input className="coop-settings-field mt-2 w-full" type="email" required maxLength={320} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </label>
            <label className="block coop-settings-row-title">Summary
              <input className="coop-settings-field mt-2 w-full" required minLength={3} maxLength={160} placeholder="What went wrong?" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block coop-settings-row-title">Details
              <textarea className="coop-settings-field mt-2 w-full" rows={9} required minLength={10} maxLength={12000} placeholder="Steps to reproduce, what you expected, and what happened. Include exact error messages when possible." value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="coop-prompt-modal-muted">Leave out passwords, API keys, and private source code. Reports are visible to CoopAI support operators.</p>
            <label className="coop-settings-checkbox-row">
              <input type="checkbox" checked={includeDiagnostics} disabled={!diagnostics} onChange={(e) => setIncludeDiagnostics(e.target.checked)} />
              <span>Include version and platform diagnostics</span>
            </label>
            {diagnostics && <details className="coop-prompt-modal-muted"><summary>Preview diagnostics</summary>
              <div className="mt-2 space-y-1"><div>CoopAI: {diagnostics.extensionVersion}</div><div>VS Code: {diagnostics.vscodeVersion}</div><div>Platform: {diagnostics.platform} / {diagnostics.architecture}</div></div>
              <p className="mt-2">Optional metadata expires after 7 days. Source files, conversations, settings, and logs are not collected.</p>
            </details>}
          </fieldset>
          {error && <CoopNotice tone="error" title={error} />}
          <div className="flex items-center gap-3"><button className="coop-settings-action-btn" type="submit" disabled={sending}>{sending ? "Sending…" : "Send report"}</button><button className="coop-text-btn" type="button" onClick={close}>Cancel</button></div>
          <p className="coop-prompt-modal-muted">Can’t sign in or send a report? Email <a href="mailto:support@coop-ai.dev">support@coop-ai.dev</a>.</p>
        </form>}
      </div>
    </div>
  </div>;
}
