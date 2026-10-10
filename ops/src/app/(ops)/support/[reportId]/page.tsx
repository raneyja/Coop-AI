"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchSupportReport, updateSupportReport, retrySupportNotification, formatDateTime, type SupportReportDetail, type SupportStatus } from "@/lib/coopApi";
import { getStoredMe } from "@/lib/auth";

export default function SupportReportPage() {
  const params = useParams<{ reportId: string }>();
  const id = params.reportId;
  const [report, setReport] = useState<SupportReportDetail>();
  const [status, setStatus] = useState<SupportStatus>("open");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const me = getStoredMe();
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(""); setReport(undefined);
    const result = await fetchSupportReport(id);
    if (generation !== loadGeneration.current) return;
    setLoading(false);
    if (!result.ok || !result.data) { setError(result.error ?? "Could not load this report."); return; }
    setReport(result.data); setStatus(result.data.status); setAssigneeId(result.data.assigneeId);
  }, [id]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!report) return;
    setSaving(true); setError(""); setNotice("");
    const result = await updateSupportReport(id, { status, assigneeId, note, revision: report.revision });
    setSaving(false);
    if (!result.ok) { setError(result.error ?? "Could not save report."); return; }
    setNote(""); setNotice("Report updated."); await load();
  }
  async function retry() {
    setSaving(true); setError(""); setNotice("");
    const result = await retrySupportNotification(id); setSaving(false);
    if (!result.ok) { setError(result.error ?? "Could not queue notification."); return; }
    setNotice("Notification queued. Refresh to check delivery."); await load();
  }
  return <div className="max-w-4xl space-y-5">
    <Link className="admin-link text-sm" href="/support">← Support inbox</Link>
    {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    {notice && <p role="status" className="text-coop-index text-sm">{notice}</p>}
    <button className="admin-btn-secondary" onClick={() => void load()} disabled={loading || saving}>Reload report</button>
    {loading ? <p className="text-coop-muted">Loading report…</p> : report && <>
      <div><h1 className="admin-page-title">{report.title}</h1><p className="text-sm text-coop-muted mt-2">{report.kind.replace(/_/g, " ")} · {formatDateTime(report.createdAt)}</p><p className="text-xs text-coop-muted mt-1 break-all">{report.id}</p></div>
      <div className="admin-card space-y-3">
        <p className="text-sm">Contact: <a className="admin-link" href={`mailto:${report.contactEmail}`}>{report.contactEmail}</a></p>
        <p className="text-sm">Customer: <Link className="admin-link" href={`/customers/${report.orgId}`}>{report.orgName ?? report.orgId}</Link></p>
        <p className="whitespace-pre-wrap break-words text-sm">{report.description}</p>
      </div>
      <div className="admin-card space-y-3"><h2 className="font-medium">Diagnostics</h2>
        {report.diagnostics ? <><dl className="text-sm space-y-1"><div>CoopAI: {report.diagnostics.extensionVersion}</div><div>VS Code: {report.diagnostics.vscodeVersion}</div><div>Platform: {report.diagnostics.platform} / {report.diagnostics.architecture}</div></dl><p className="text-xs text-coop-muted">Expires {formatDateTime(report.diagnosticsExpiresAt ?? "")}</p></> : <p className="text-sm text-coop-muted">Not included or expired.</p>}
      </div>
      <form className="admin-card space-y-4" onSubmit={save}>
        <h2 className="font-medium">Triage</h2>
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-sm">Status<select className="admin-input mt-2 w-full" value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></label>
          <div className="flex flex-wrap items-center gap-3 text-sm"><span>{assigneeId ? assigneeId === me?.id ? "Assigned to you" : `Assigned to ${report.assigneeEmail ?? assigneeId}` : "Unassigned"}</span><button type="button" className="admin-btn-secondary" disabled={!me} onClick={() => setAssigneeId(me?.id ?? null)}>Assign to me</button><button type="button" className="admin-btn-secondary" onClick={() => setAssigneeId(null)}>Unassign</button></div>
          <label className="block text-sm">Internal note<textarea className="admin-input mt-2 w-full" rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation, resolution, or next steps" /></label>
          <p className="text-xs text-coop-muted">Notes stay in ops. Contact the reporter by email for a reply.</p>
          <button className="admin-btn-primary" type="submit">{saving ? "Saving…" : "Save changes"}</button>
        </fieldset>
      </form>
      <div className="admin-card space-y-3"><h2 className="font-medium">Team notification</h2><p className="text-sm">{report.notificationStatus} · {report.notificationAttempts} attempt(s)</p>
        {(report.notificationStatus === "failed" || report.notificationStatus === "mocked") && <button className="admin-btn-secondary" disabled={saving} onClick={() => void retry()}>Retry notification</button>}
      </div>
      <div className="admin-card space-y-4"><h2 className="font-medium">Activity</h2>
        {!report.events.length && <p className="text-sm text-coop-muted">No triage activity yet.</p>}
        {report.events.map((event) => <div key={event.id} className="text-sm border-t border-coop-border/40 pt-3"><p>{event.operatorEmail} · {event.status.replace(/_/g, " ")} · {event.assigneeEmail ?? "Unassigned"}</p><p className="text-xs text-coop-muted mt-1">{formatDateTime(event.createdAt)}</p>{event.note && <p className="whitespace-pre-wrap break-words mt-2">{event.note}</p>}</div>)}
      </div>
    </>}
  </div>;
}
