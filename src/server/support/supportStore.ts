import type { Pool } from "pg";
import type { SupportSubmission, SupportStatus } from "../../support/supportTypes";

export class SupportStore {
  public constructor(private readonly pool: Pool) {}

  public async submit(orgId: string, principal: string, input: SupportSubmission): Promise<{ id: string; limited?: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // A database lock makes rate limiting and retry deduplication consistent across replicas.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`support:${orgId}:${principal}`]);
      const existing = await client.query("SELECT id FROM support_reports WHERE org_id=$1 AND principal=$2 AND submission_id=$3", [orgId, principal, input.submissionId]);
      if (existing.rows[0]) { await client.query("COMMIT"); return { id: existing.rows[0].id }; }
      const count = await client.query("SELECT count(*)::int AS count FROM support_reports WHERE org_id=$1 AND principal=$2 AND created_at > NOW() - INTERVAL '1 hour'", [orgId, principal]);
      if (count.rows[0].count >= 10) { await client.query("COMMIT"); return { id: "", limited: true }; }
      const result = await client.query(`INSERT INTO support_reports
        (org_id,principal,submission_id,kind,title,description,contact_email,diagnostics,diagnostics_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::jsonb IS NULL THEN NULL ELSE NOW() + INTERVAL '7 days' END) RETURNING id`,
        [orgId, principal, input.submissionId, input.kind, input.title, input.description, input.contactEmail, input.diagnostics ?? null]);
      await client.query("COMMIT");
      return { id: result.rows[0].id };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  public async list(status: SupportStatus | undefined, offset: number) {
    const result = await this.pool.query(`SELECT r.id,r.title,r.kind,r.status,r.contact_email AS "contactEmail",
      r.org_id AS "orgId",o.name AS "orgName",r.assignee_id AS "assigneeId",a.email AS "assigneeEmail",
      r.notification_status AS "notificationStatus",r.created_at AS "createdAt",r.updated_at AS "updatedAt"
      FROM support_reports r JOIN organizations o ON o.id=r.org_id LEFT JOIN operators a ON a.id=r.assignee_id
      WHERE ($1::text IS NULL OR r.status=$1) ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $2`, [status ?? null, offset]);
    return { reports: result.rows.slice(0, 50), nextOffset: result.rows.length > 50 ? offset + 50 : undefined };
  }

  public async detail(id: string) {
    const result = await this.pool.query(`SELECT r.id,r.title,r.kind,r.status,r.description,r.contact_email AS "contactEmail",
      r.org_id AS "orgId",o.name AS "orgName",r.assignee_id AS "assigneeId",a.email AS "assigneeEmail",
      r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.resolved_at AS "resolvedAt",r.revision,
      r.notification_status AS "notificationStatus",r.notification_attempts AS "notificationAttempts",
      CASE WHEN r.diagnostics_expires_at > NOW() THEN r.diagnostics ELSE NULL END AS diagnostics,
      r.diagnostics_expires_at AS "diagnosticsExpiresAt" FROM support_reports r
      JOIN organizations o ON o.id=r.org_id LEFT JOIN operators a ON a.id=r.assignee_id WHERE r.id=$1`, [id]);
    if (!result.rows[0]) return undefined;
    const events = await this.pool.query(`SELECT e.id,e.status,e.note,e.created_at AS "createdAt",o.email AS "operatorEmail",a.email AS "assigneeEmail"
      FROM support_report_events e JOIN operators o ON o.id=e.operator_id LEFT JOIN operators a ON a.id=e.assignee_id
      WHERE report_id=$1 ORDER BY e.created_at,e.id`, [id]);
    return { ...result.rows[0], events: events.rows };
  }

  public async update(id: string, operatorId: string, input: { status: SupportStatus; assigneeId: string | null; note: string; revision: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.assigneeId) {
        const assignee = await client.query("SELECT id FROM operators WHERE id=$1 AND disabled_at IS NULL AND role IN ('support','billing','super_admin')", [input.assigneeId]);
        if (!assignee.rows[0]) { await client.query("ROLLBACK"); return "invalid_assignee"; }
      }
      const result = await client.query(`UPDATE support_reports SET status=$2,assignee_id=$3,updated_at=NOW(),revision=revision+1,
        resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,NOW()) ELSE NULL END
        WHERE id=$1 AND revision=$4 RETURNING org_id`, [id, input.status, input.assigneeId, input.revision]);
      if (!result.rows[0]) { await client.query("ROLLBACK"); return "conflict"; }
      await client.query("INSERT INTO support_report_events(report_id,operator_id,status,assignee_id,note) VALUES ($1,$2,$3,$4,$5)", [id, operatorId, input.status, input.assigneeId, input.note]);
      await client.query("INSERT INTO operator_audit_log(operator_id,action,target_org_id,metadata) VALUES ($1,'support.report.updated',$2,$3)", [operatorId, result.rows[0].org_id, { reportId: id, status: input.status, assigneeId: input.assigneeId }]);
      await client.query("COMMIT");
      return "ok";
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  public async retryNotification(id: string) {
    const result = await this.pool.query(`UPDATE support_reports SET notification_status='pending',notification_attempts=0,notification_next_attempt_at=NOW()
      WHERE id=$1 AND notification_status IN ('failed','mocked') RETURNING id`, [id]);
    return Boolean(result.rows[0]);
  }

  public async purgeDiagnostics() {
    await this.pool.query("UPDATE support_reports SET diagnostics=NULL WHERE diagnostics IS NOT NULL AND diagnostics_expires_at <= NOW()");
  }

  public async claimNotification() {
    const result = await this.pool.query(`UPDATE support_reports SET notification_attempts=notification_attempts+1,
      notification_next_attempt_at=NOW() + INTERVAL '2 minutes' WHERE id=(
      SELECT id FROM support_reports WHERE notification_status='pending' AND notification_next_attempt_at <= NOW()
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,kind,title,description,contact_email AS "contactEmail",notification_attempts AS attempts`, []);
    return result.rows[0] as { id: string; kind: string; title: string; description: string; contactEmail: string; attempts: number } | undefined;
  }

  public async finishNotification(id: string, attempts: number, status: "sent" | "mocked" | "pending" | "failed") {
    await this.pool.query(`UPDATE support_reports SET notification_status=$3,
      notification_next_attempt_at=NOW() + (LEAST(3600,60 * power(2,LEAST($2,6))) * INTERVAL '1 second')
      WHERE id=$1 AND notification_attempts=$2`, [id, attempts, status]);
  }
}
