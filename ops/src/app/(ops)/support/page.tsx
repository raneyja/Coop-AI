"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchSupportReports, formatDateTime, type SupportReportSummary, type SupportStatus } from "@/lib/coopApi";

export default function SupportInboxPage() {
  const [reports, setReports] = useState<SupportReportSummary[]>([]);
  const [status, setStatus] = useState<SupportStatus | "">("open");
  const [nextOffset, setNextOffset] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function load(filter: SupportStatus | "", offset = 0) {
    const request = ++generation.current;
    setLoading(true); setError("");
    const result = await fetchSupportReports(filter, offset);
    if (request !== generation.current) return;
    setLoading(false);
    if (!result.ok || !result.data) { setError(result.error ?? "Could not load support reports."); return; }
    setReports((previous) => offset ? [...previous, ...result.data!.reports] : result.data!.reports);
    setNextOffset(result.data.nextOffset);
  }
  useEffect(() => { setReports([]); setNextOffset(undefined); void load(status); return () => { generation.current++; }; }, [status]);
  return <div className="space-y-6">
    <div><h1 className="admin-page-title">Support inbox</h1><p className="mt-1 text-sm text-coop-muted">Bug reports, feedback, and feature requests from the VS Code extension.</p></div>
    <div className="flex items-center gap-3">
      <label className="text-sm">Status <select className="admin-input ml-2" value={status} disabled={loading} onChange={(e) => setStatus(e.target.value as SupportStatus | "")}>
        <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="">All</option>
      </select></label>
      <button className="admin-btn-secondary" disabled={loading} onClick={() => void load(status)}>Refresh</button>
    </div>
    {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    <div className="space-y-3">
      {reports.map((report) => <Link key={report.id} href={`/support/${report.id}`} className="admin-card block hover:border-coop-index/50">
        <div className="flex items-start justify-between gap-3"><h2 className="font-medium">{report.title}</h2><span className="admin-chip admin-chip--muted">{report.status.replace(/_/g, " ")}</span></div>
        <p className="text-sm text-coop-muted mt-2">{report.orgName} · {report.contactEmail} · {report.kind.replace(/_/g, " ")}</p>
        <p className="text-xs text-coop-muted mt-2">{formatDateTime(report.createdAt)} · {report.assigneeEmail ?? "Unassigned"} · Email {report.notificationStatus}</p>
      </Link>)}
      {loading && <p role="status" className="text-coop-muted">Loading reports…</p>}
      {!loading && !error && !reports.length && <div className="admin-card text-coop-muted">No reports with this status.</div>}
    </div>
    {nextOffset !== undefined && <button className="admin-btn-secondary" disabled={loading} onClick={() => void load(status, nextOffset)}>Load more</button>}
  </div>;
}
