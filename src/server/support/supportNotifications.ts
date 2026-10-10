import type { EmailService } from "../email/emailService";
import type { SupportStore } from "./supportStore";

export async function processSupportNotifications(store: SupportStore, email: EmailService, opsUrl: string, to: string): Promise<void> {
  await store.purgeDiagnostics();
  for (let i = 0; i < 10; i++) {
    const report = await store.claimNotification();
    if (!report) break;
    try {
      const result = await email.sendSupportNotification({ to, reportId: report.id, kind: report.kind, title: report.title,
        description: report.description, contactEmail: report.contactEmail, reviewUrl: `${opsUrl.replace(/\/$/, "")}/support/${report.id}` });
      await store.finishNotification(report.id, report.attempts, result.mocked ? "mocked" : "sent");
    } catch {
      // Never log report contents or provider response bodies. The inbox remains usable during outages.
      await store.finishNotification(report.id, report.attempts, report.attempts >= 8 ? "failed" : "pending");
      console.warn(`[support] notification attempt ${report.attempts} failed for ${report.id}`);
    }
  }
}

export function startSupportNotifications(store: SupportStore, email: EmailService, opsUrl: string, to: string): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processSupportNotifications(store, email, opsUrl, to); }
    catch { console.warn("[support] inbox maintenance unavailable; check migration 032 and database connectivity"); }
    finally { running = false; }
  };
  const interval = setInterval(() => { void tick(); }, 30000);
  interval.unref();
  void tick();
  return () => clearInterval(interval);
}
