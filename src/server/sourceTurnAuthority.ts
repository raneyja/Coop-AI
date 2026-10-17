import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { V1ChatRequestBody, OrdinaryTurnPhase, ChatOrgPlan } from "../api/types";
import { SOURCE_CLAIM_REVIEW_BATCH_SIZE } from "../config/featureModelAssignments";
import { normalizeChatRequestBody } from "../api/chatContinuation";
import { LENGTH_CONTINUE_PROMPT } from "../chat/lengthContinue";
import { agentPlanningRepoId, buildAgentToolPlanPrompt } from "../api/agent/parseAgentToolPlan";
import { UsageTracker } from "./usageTracker";
import { PlanQuotaUnavailableError, type PlanQuotaService } from "./planQuota";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class SourceTurnDenied extends Error {
  public constructor() { super("The source turn is unavailable or does not match this request. Start a new turn."); }
}
class CostCallBusy extends Error {}
export type ChatCallBillingContext = {plan: ChatOrgPlan;entry: Omit<Parameters<PlanQuotaService["recordTokens"]>[2],"inputTokens"|"outputTokens">};
export type TurnAdmission = { id: string; source: boolean; callId?: string; orgId?: string; subject?: string; ordinaryPhase?: OrdinaryTurnPhase };
type EvidenceBinding = { identityHash: string; evidenceId: string; taskHash: string };

export type HonoredChatRoute = {provider: string; model: string; maxTokens: number; temperature: number};
export const ordinaryContinuationHash = (body: V1ChatRequestBody, route: HonoredChatRoute) =>
  hash(JSON.stringify({request: normalizeChatRequestBody(body), route}));

/** Validates the exact common generation/review envelope, not caller hashes alone.
 * Source content is used transiently; only digests enter the authority ledger. */
function evidenceBinding(message: string, context: unknown, taskField: "task" | "question"): EvidenceBinding {
  const data = record(JSON.parse(message));
  if (Buffer.byteLength(message, "utf8") > 1_000_000) throw new SourceTurnDenied();
  if (data.schema !== (taskField === "task" ? "coop-source-evidence-v1" : "coop-source-claims-v3")) throw new SourceTurnDenied();
  if (taskField === "question" && (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > SOURCE_CLAIM_REVIEW_BATCH_SIZE
    || new Set(data.blocks.map((value: unknown) => record(value).id)).size !== data.blocks.length
    || data.blocks.some((value: unknown) => {
      const block = record(value), context = record(block.context);
      return typeof block.id !== "string" || typeof block.text !== "string" || !block.text.trim() || block.text.length > 16_000
        || (block.context !== null && (typeof context.id !== "string" || typeof context.text !== "string" || context.text.length > 32_000));
    }))) throw new SourceTurnDenied();
  const allowed = taskField === "task" ? ["schema","task","action","identity","windows","facts","coverage","evidenceId"]
    : ["schema","candidateId","question","blocks","reviewCoverage","identity","windows","facts","coverage","evidenceId"];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new SourceTurnDenied();
  const identity = record(data.identity), ctx = record(context);
  const expected = { owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, file: ctx.file };
  if (JSON.stringify(identity) !== JSON.stringify(expected) || typeof ctx.owner !== "string" || typeof ctx.repo !== "string"
    || !ctx.owner || !ctx.repo || typeof ctx.branch !== "string" || !ctx.branch) throw new SourceTurnDenied();
  if (!Array.isArray(data.windows) || data.windows.length > 128 || !Array.isArray(data.facts) || data.facts.length > 512
    || typeof data.coverage !== "string" || typeof data[taskField] !== "string" || !(data[taskField] as string).trim()) throw new SourceTurnDenied();
  const windows = data.windows.map((value: unknown, index: number) => {
    const w = record(value);
    if (Object.keys(w).some(key => !["id","path","startLine","endLine","lines"].includes(key)) || w.id !== `window-${index + 1}` || typeof w.path !== "string" || !w.path || !Number.isSafeInteger(w.startLine)
      || Number(w.startLine) < 1 || !Number.isSafeInteger(w.endLine) || Number(w.endLine) < Number(w.startLine)
      || !Array.isArray(w.lines) || w.lines.length !== Number(w.endLine) - Number(w.startLine) + 1
      || w.lines.some((value: unknown, offset: number) => {
        const line = record(value); return Object.keys(line).some(key => !["line","text"].includes(key)) || line.line !== Number(w.startLine) + offset || typeof line.text !== "string";
      })) throw new SourceTurnDenied();
    return {id: w.id, path: w.path, startLine: w.startLine, endLine: w.endLine,
      content: w.lines.map((value: unknown) => record(value).text).join("\n")};
  });
  if (data.facts.some((value: unknown, index: number) => record(value).id !== `fact-${index + 1}`)) throw new SourceTurnDenied();
  const canonical = {identity, windows, facts: data.facts, coverage: data.coverage};
  const evidenceId = hash(JSON.stringify(canonical));
  if (evidenceId !== data.evidenceId) throw new SourceTurnDenied();
  return {identityHash: hash(JSON.stringify(identity)), evidenceId, taskHash: hash(data[taskField] as string)};
}

/** Reconstruct the phase prompt from task-bound structured data. Independent
 * ordinary questions cannot borrow a planning label or an unrelated history. */
export function ordinaryPlanPrompt(body: V1ChatRequestBody): string {
  const input=record(JSON.parse(String(body.message))), envelope=body.ordinaryTurn, ctx=body.context ?? {};
  if (!envelope || envelope.phase!=="plan" || input.message!==envelope.task || !Number.isInteger(input.round)
    || Number(input.round)<0 || Number(input.round)>=8 || !Array.isArray(input.priorSummaries) || input.priorSummaries.length>8
    || input.priorSummaries.some(v=>typeof v!=="string" || v.length>8000)
    || typeof input.repoId!=="string" || agentPlanningRepoId(input.repoId, ctx, input.allowedRepoTools) !== input.repoId
    || (input.lastToolResult!==undefined && (typeof input.lastToolResult!=="string" || input.lastToolResult.length>100000))
    || (input.allowedIntegrations!==undefined && (!Array.isArray(input.allowedIntegrations) || input.allowedIntegrations.length>6
      || input.allowedIntegrations.some(v=>!["jira","slack","teams","notion","confluence","google-docs"].includes(String(v)))))
    || (input.allowedRepoTools!==undefined && typeof input.allowedRepoTools!=="boolean")
    || (body.history?.some(v=>v.attachments?.length) || body.attachments?.length)) throw new SourceTurnDenied();
  if (Buffer.byteLength(String(body.message))>250000) throw new SourceTurnDenied();
  // The shared builder handles typed suggestions/instructions. Reject malformed
  // auxiliary shapes before invoking it; their contents remain untrusted data.
  for (const name of ["intentPurpose","projectInstructions"]) if(input[name]!==undefined && typeof input[name]!=="string") throw new SourceTurnDenied();
  if (input.suggestedJobs!==undefined && (!Array.isArray(input.suggestedJobs) || input.suggestedJobs.length>16
    || input.suggestedJobs.some(v=> {const j=record(v);return typeof j.capability!=="string" || !Array.isArray(j.terms) || j.terms.some(t=>typeof t!=="string")
      || (j.searchCriteria!==undefined && (!Array.isArray(j.searchCriteria) || j.searchCriteria.some(t=>typeof t!=="string")));}))) throw new SourceTurnDenied();
  return buildAgentToolPlanPrompt(input as Parameters<typeof buildAgentToolPlanPrompt>[0]);
}

/** Database authority is shared across API processes. One phase at a time; one
 * repair, at most 64 bounded review calls, and a terminal client close or expiry.
 * Holding the org lock through quota reservation prevents parallel Free admits. */
export class SourceTurnAuthority {
  public constructor(private readonly pool: Pool) {}

  public async admit(input: Parameters<SourceTurnAuthority["tryAdmit"]>[0]): Promise<TurnAdmission> {
    for (;;) {
      input.signal?.throwIfAborted();
      try { return await this.tryAdmit(input); }
      catch (error) {
        if (!(error instanceof CostCallBusy)) throw error;
        // Wait outside the transaction; no provider work or message/phase slot
        // is consumed by queued contenders. Stop cancels admission promptly.
        await new Promise<void>((resolve,reject) => {
          const finish = () => {input.signal?.removeEventListener("abort",abort);resolve();};
          const timer = setTimeout(finish,100);
          const abort = () => {clearTimeout(timer);input.signal?.removeEventListener("abort",abort);reject(input.signal?.reason ?? new Error("Admission cancelled"));};
          input.signal?.addEventListener("abort",abort,{once:true});
          if(input.signal?.aborted) abort();
        });
      }
    }
  }

  private async tryAdmit(input: {orgId: string; actorBinding: string; body: V1ChatRequestBody; quota: PlanQuotaService;
    honoredRoute?: HonoredChatRoute; signal?: AbortSignal; billingSubject?: string; billingContext?: ChatCallBillingContext; check: (quota: PlanQuotaService, id: string, continuation: boolean, now: Date) => Promise<void>}): Promise<TurnAdmission> {
    const {body} = input;
    const source = body.sourceClaimReview === true || body.sourceEvidenceSynthesis === true;
    let continuation = body.sourceClaimReview === true || body.sourceEvidenceRepair === true;
    const clientId = typeof body.quotaTurnId === "string" ? body.quotaTurnId.trim() : "";
    if ((source || body.ordinaryTurn) && (!clientId || clientId.length > 160)) throw new SourceTurnDenied();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query(`DELETE FROM chat_source_turns WHERE id IN (SELECT id FROM chat_source_turns
        WHERE org_id=$1 AND expires_at < clock_timestamp() - INTERVAL '1 day' ORDER BY expires_at LIMIT 32)`, [input.orgId]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`chat-quota:${input.orgId}`]);
      const callId = randomUUID();
      let id = randomUUID();
      if (body.ordinaryTurn) {
        if (source) throw new SourceTurnDenied();
        const envelope = body.ordinaryTurn;
        if (!["plan","answer","continue"].includes(envelope.phase) || typeof envelope.task !== "string"
          || !envelope.task.trim() || envelope.task.length > 32_000
          || !["chat","code_edit","integration","intent_job","comprehension","decision_archaeology","ownership","blast_radius","knowledge_gaps"].includes(envelope.answerUseCase)
          || body.useCase !== (envelope.phase === "plan" ? "chat" : envelope.answerUseCase)) throw new SourceTurnDenied();
        if (envelope.phase === "plan") ordinaryPlanPrompt(body);
        if (envelope.phase === "continue" && body.message !== LENGTH_CONTINUE_PROMPT) throw new SourceTurnDenied();
        const ctx = body.context ?? {}, identityHash = hash(JSON.stringify([ctx.owner,ctx.repo,ctx.branch]));
        const taskHash = hash(envelope.task);
        const existing = await client.query("SELECT * FROM chat_ordinary_turns WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3 FOR UPDATE", [input.orgId,input.actorBinding,clientId]);
        let turn = existing.rows[0];
        if (!turn) {
          if (envelope.phase === "continue" || (await client.query("SELECT id FROM chat_source_turns WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3", [input.orgId,input.actorBinding,clientId])).rowCount) throw new SourceTurnDenied();
          await client.query(`INSERT INTO chat_ordinary_turns(id,org_id,actor_binding,client_turn_id,task_hash,identity_hash,answer_use_case,state)
            VALUES($1,$2,$3,$4,$5,$6,$7,'gather')`,[id,input.orgId,input.actorBinding,clientId,taskHash,identityHash,envelope.answerUseCase]);
          turn = {id,task_hash:taskHash,identity_hash:identityHash,answer_use_case:envelope.answerUseCase,state:"gather"};
        } else {id = turn.id; continuation = true;}
        if (turn.task_hash !== taskHash || turn.identity_hash !== identityHash || turn.answer_use_case !== envelope.answerUseCase) throw new SourceTurnDenied();
        if (envelope.phase === "continue" && (!input.honoredRoute || !turn.continuation_hash
          || ordinaryContinuationHash(body,input.honoredRoute) !== turn.continuation_hash)) throw new SourceTurnDenied();
        if (envelope.phase === "plan" && JSON.parse(String(body.message)).round !== (turn.plan_calls ?? 0)) throw new SourceTurnDenied();
        const transitions = {
          plan: "state='gather' AND plan_calls<8",
          answer: "state='gather'", continue: "state='continuation_ready'"
        };
        const changes = {plan:"plan_calls=plan_calls+1",answer:"state='answer_busy'",continue:"state='continue_busy',continuation_hash=NULL"};
        const changed = await client.query(`UPDATE chat_ordinary_turns SET ${changes[envelope.phase]} WHERE id=$1 AND expires_at>clock_timestamp() AND ${transitions[envelope.phase]} RETURNING id`,[id]);
        if (!changed.rowCount) throw new SourceTurnDenied();
      } else if (continuation) {
        const result = await client.query(`SELECT * FROM chat_source_turns WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3
          AND state='ready' AND expires_at > clock_timestamp() FOR UPDATE`, [input.orgId, input.actorBinding, clientId]);
        const turn = result.rows[0];
        if (!turn || turn.use_case !== body.useCase) throw new SourceTurnDenied();
        id = turn.id;
        if (body.sourceClaimReview === true) {
          const binding = evidenceBinding(String(body.message), body.context, "question");
          if (binding.identityHash !== turn.identity_hash || binding.evidenceId !== turn.evidence_id
            || binding.taskHash !== turn.task_hash || turn.review_calls >= 64) throw new SourceTurnDenied();
          await client.query("UPDATE chat_source_turns SET state='busy', review_calls=review_calls+1, active_call_id=$2 WHERE id=$1", [id,callId]);
        } else {
          const message = String(body.message), prefix = message.slice(0, turn.synthesis_length);
          const binding = evidenceBinding(prefix, body.context, "task");
          if (hash(prefix) !== turn.synthesis_hash || binding.identityHash !== turn.identity_hash
            || binding.evidenceId !== turn.evidence_id || binding.taskHash !== turn.task_hash
            || turn.repair_calls !== 0 || !message.slice(turn.synthesis_length).trim()) throw new SourceTurnDenied();
          await client.query("UPDATE chat_source_turns SET state='busy', repair_calls=repair_calls+1, active_call_id=$2 WHERE id=$1", [id,callId]);
        }
      } else if (source) {
        if ((await client.query("SELECT id FROM chat_ordinary_turns WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3", [input.orgId,input.actorBinding,clientId])).rowCount) throw new SourceTurnDenied();
        const binding = evidenceBinding(String(body.message), body.context, "task");
        if (record(JSON.parse(String(body.message))).action !== body.useCase) throw new SourceTurnDenied();
        const result = await client.query(`INSERT INTO chat_source_turns
          (id,org_id,actor_binding,client_turn_id,identity_hash,evidence_id,task_hash,synthesis_hash,synthesis_length,use_case,active_call_id,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'busy') ON CONFLICT DO NOTHING RETURNING id`,
        [id,input.orgId,input.actorBinding,clientId,binding.identityHash,binding.evidenceId,binding.taskHash,
          hash(String(body.message)),String(body.message).length,body.useCase,callId]);
        if (!result.rowCount) throw new SourceTurnDenied();
      }
      const tracker = new UsageTracker(client);
      // PG timestamps have microseconds; JavaScript Date truncates to milliseconds.
      // A floor would omit a just-committed cost in the same millisecond. Use the
      // database clock rounded upward, under the same admission transaction.
      const clock = await client.query("SELECT CEIL(EXTRACT(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms");
      await input.check(input.quota.withUsageTracker(tracker), id, continuation, new Date(Number(clock.rows[0].now_ms)));
      if (input.billingSubject) {
        // The dispatch transition also rejects expired reservations, so a stale
        // pending row is authoritative zero-spend even after a process crash.
        await client.query("UPDATE chat_cost_admissions SET state='settled',settled_at=clock_timestamp() WHERE org_id=$1 AND subject=$2 AND state='pending' AND created_at<clock_timestamp()-interval '15 minutes'",[input.orgId,input.billingSubject]);
        const pending = await client.query("SELECT id,state,created_at FROM chat_cost_admissions WHERE org_id=$1 AND subject=$2 AND state<>'settled'", [input.orgId,input.billingSubject]);
        if (pending.rowCount) {
          const call = pending.rows[0];
          if (call.state === "unresolved" || Date.now()-new Date(call.created_at).getTime() > 15*60_000) throw new PlanQuotaUnavailableError(`Usage metering for an earlier model request awaits reconciliation. Contact support@coop-ai.dev with reference ${call.id} so its final usage can be reconciled.`);
          throw new CostCallBusy();
        }
      }
      if (!continuation) await tracker.recordRequired({orgId: input.orgId, principal: "server:chat-admission", eventType: "chat.turn_reserved",
        metadata: {quotaTurnId: id, countsAsMessage: !["intent_suggest","evidence_preview","pr_summary","inline_completion"].includes(String(body.useCase))}});
      if (input.billingSubject) await client.query("INSERT INTO chat_cost_admissions(id,org_id,subject,billing_context,state) VALUES($1,$2,$3,$4::jsonb,'pending')", [callId,input.orgId,input.billingSubject,JSON.stringify(input.billingContext ? {...input.billingContext,entry:{...input.billingContext.entry,quotaTurnId:id,metadata:{...input.billingContext.entry.metadata,billingCallId:callId}}} : {})]);
      await client.query("COMMIT");
      return {id,source,callId,orgId: input.orgId,subject: input.billingSubject,ordinaryPhase: body.ordinaryTurn?.phase};
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  public async markDispatched(turn: TurnAdmission): Promise<void> {
    if (!turn.subject) return;
    const result=await this.pool.query("UPDATE chat_cost_admissions SET state='dispatched' WHERE id=$1 AND state='pending' AND created_at>clock_timestamp()-interval '15 minutes' RETURNING id",[turn.callId]);
    if (!result.rowCount) throw new PlanQuotaUnavailableError();
  }

  /** Commit known actual spend, release only its commitment, and transition the
   * grant atomically before terminal success can be published. */
  public async settle(turn: TurnAdmission, quota: PlanQuotaService, successful: boolean,
    recordUsage: (quota: PlanQuotaService) => Promise<void>, continuationHash?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`chat-quota:${turn.orgId}`]);
      await recordUsage(quota.withUsageTracker(new UsageTracker(client)));
      if (turn.subject) {
        const result = await client.query("UPDATE chat_cost_admissions SET state='settled',settled_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND subject=$3 RETURNING id", [turn.callId,turn.orgId,turn.subject]);
        if (!result.rowCount) throw new PlanQuotaUnavailableError();
      }
      if (turn.source) await client.query("UPDATE chat_source_turns SET state=$2 WHERE id=$1 AND active_call_id=$3 AND state='busy'", [turn.id,successful ? "ready" : "closed",turn.callId]);
      await this.finishOrdinary(client,turn,successful,continuationHash);
      await client.query("COMMIT");
    } catch (error) {await client.query("ROLLBACK").catch(() => undefined); throw error;}
    finally {client.release();}
  }

  public async complete(turn: TurnAdmission, successful: boolean): Promise<void> {
    // Provider dispatch is marked durably before invocation. Pending is proven
    // zero-dispatch; dispatched without usage remains unresolved, including Stop.
    if (turn.subject) await this.pool.query(`UPDATE chat_cost_admissions
      SET state=CASE WHEN state='pending' THEN 'settled' ELSE 'unresolved' END,
        settled_at=CASE WHEN state='pending' THEN clock_timestamp() ELSE NULL END
      WHERE id=$1 AND state IN ('pending','dispatched')`, [turn.callId]);
    await this.finishOrdinary(this.pool,turn,successful);
    if (turn.source) await this.pool.query("UPDATE chat_source_turns SET state=$2 WHERE id=$1 AND active_call_id=$3 AND state='busy'",
      [turn.id, successful ? "ready" : "closed",turn.callId]);
  }

  /** Accepted autocomplete has known usage and no provider work inside this
   * transaction, so it can check and record immediately under the same lock. */
  public async recordImmediate(orgId: string, subject: string | undefined, quota: PlanQuotaService,
    record: (quota: PlanQuotaService, now: Date) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`chat-quota:${orgId}`]);
      if (subject && (await client.query("SELECT id FROM chat_cost_admissions WHERE org_id=$1 AND subject=$2 AND state<>'settled'", [orgId,subject])).rowCount) throw new PlanQuotaUnavailableError();
      const clock = await client.query("SELECT CEIL(EXTRACT(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms");
      await record(quota.withUsageTracker(new UsageTracker(client)), new Date(Number(clock.rows[0].now_ms)));
      await client.query("COMMIT");
    } catch (error) {await client.query("ROLLBACK").catch(() => undefined); throw error;}
    finally {client.release();}
  }
  /** Maintenance-only recovery owner; no client route exposes this method.
   * The operator must obtain final usage from the provider, retain its receipt,
   * and supply its reference/hash. No expiry, Stop or close invents a charge. */
  public async reconcileUsage(orgId: string, callId: string, quota: PlanQuotaService,
    usage: {inputTokens:number;outputTokens:number;receiptReference:string;receiptSha256:string}): Promise<void> {
    if (![usage.inputTokens,usage.outputTokens].every(v=>Number.isSafeInteger(v)&&v>=0)
      || !usage.receiptReference.trim() || usage.receiptReference.length>256 || !/^[a-f0-9]{64}$/.test(usage.receiptSha256)) throw new PlanQuotaUnavailableError();
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chat-quota:${orgId}`]);
      const row=(await client.query("SELECT * FROM chat_cost_admissions WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,callId])).rows[0];
      if (!row) throw new PlanQuotaUnavailableError();
      if (row.state==='settled') {await client.query("COMMIT");return;}
      const context=row.billing_context as ChatCallBillingContext;
      if (!context.entry?.provider || !context.entry.model || !context.entry.principal || !['free','pro','enterprise'].includes(context.plan)) throw new PlanQuotaUnavailableError();
      const q=quota.withUsageTracker(new UsageTracker(client));
      await q.recordTokens(orgId,context.plan,{...context.entry,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,
        metadata:{...context.entry.metadata,billingCallId:callId,reconciliationReceipt:usage.receiptReference,reconciliationSha256:usage.receiptSha256}});
      await client.query("UPDATE chat_cost_admissions SET state='settled',settled_at=clock_timestamp() WHERE id=$1",[callId]);
      if(context.entry.quotaTurnId) {
        await client.query("UPDATE chat_source_turns SET state='closed' WHERE id=$1",[context.entry.quotaTurnId]);
        await client.query("UPDATE chat_ordinary_turns SET state='closed',continuation_hash=NULL WHERE id=$1",[context.entry.quotaTurnId]);
      }
      await client.query("COMMIT");
    } catch(error) {await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally {client.release();}
  }

  private async finishOrdinary(db: Pick<Pool,"query">, turn: TurnAdmission, successful: boolean, continuationHash?: string): Promise<void> {
    if (turn.ordinaryPhase === "answer" || turn.ordinaryPhase === "continue")
      await db.query("UPDATE chat_ordinary_turns SET state=$2,continuation_hash=$4 WHERE id=$1 AND state=$3", [turn.id,
        turn.ordinaryPhase === "answer" && successful && continuationHash ? "continuation_ready" : "closed",
        turn.ordinaryPhase === "answer" ? "answer_busy" : "continue_busy",
        turn.ordinaryPhase === "answer" && successful ? continuationHash ?? null : null]);
  }

  public async close(orgId: string, actorBinding: string, clientId: string): Promise<void> {
    await this.pool.query("UPDATE chat_ordinary_turns SET state='closed',continuation_hash=NULL WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3", [orgId,actorBinding,clientId]);
    await this.pool.query("UPDATE chat_source_turns SET state='closed' WHERE org_id=$1 AND actor_binding=$2 AND client_turn_id=$3",
      [orgId, actorBinding, clientId]);
  }
}

/** A session/API-key change cannot inherit another actor's turn authority. */
export const sourceTurnActorBinding = (orgId: string, principal: string, authorization: string | undefined) =>
  hash(JSON.stringify([orgId, principal, authorization ?? ""]));
