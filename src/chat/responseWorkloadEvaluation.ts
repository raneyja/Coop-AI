/** Bounded, repeatable harness for the real API stream and source-publication
 * owners. Synthetic provider/source cache: these are NOT live latency results. */
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { handleChatApiRequest } from "../api/chatApi";
import type { ModelRouter } from "../api/ModelRouter";
import type { PlanQuotaService } from "../server/planQuota";
import type { StreamChunk } from "../api/types";
import { SecureApiClient, type StreamChatParams } from "./SecureApiClient";
import { ResponseTimingTrace, registerResponseTiming, type ResponseTimingEvent } from "./chatResponseTiming";
import { streamSourceReviewedKnowledgeGaps } from "./knowledgeGapsSourceReview";
import { KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER } from "../prompts/knowledgeGapsSynthesis";
import { verifySourceCitationQuotes } from "../prompts/sourceCitationIntegrity";
import type { KnowledgeGapsEvidence } from "../context/contextBundleEvidence";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";

const families = [
  { language: "typescript", structure: "modular", path: "src/core/check.ts", source: "if (enabled && allowed) reject();" },
  { language: "python", structure: "flat", path: "check.py", source: "if enabled and allowed:\n    reject()" },
  { language: "rust", structure: "workspace", path: "crates/core/src/check.rs", source: "if enabled && allowed { reject(); }" },
  { language: "go", structure: "packages", path: "internal/core/check.go", source: "if enabled && allowed { reject() }" }
];
const volumes = [{ label: "thin", files: 1, padding: 0 }, { label: "multi-file", files: 4, padding: 1000 },
  { label: "bounded-large", files: 6, padding: 7800 }];
export type WorkloadResult = {
  workload: { language: string; structure: string; evidence: string; files: number; sourceChars: number;
    cache: "fixture-cold" | "fixture-warm"; cacheHit: boolean; concurrency: number; scenario: string };
  mode: "harness-synthetic-provider";
  timings: { publicationMs: number | null; hostCompletionMs: number | null; firstVisibleAnswerContentMs: null;
    firstUsefulSupportedAnswerMs: null; displayCompletionMs: null };
  quality: { sourceRef: "pass"; citationIntegrity: "pass" | "fail"; supportedClaims: "pass" | "fail";
    truthfulUnknowns: "pass" | "fail"; requestedTask: "pass" | "fail"; adjudication: "fixture-author-review" };
  events: ResponseTimingEvent[];
};

export async function evaluateResponseWorkloads(): Promise<{ schemaVersion: number; applicability: string; results: WorkloadResult[] }> {
  const originalFetch = globalThis.fetch;
  // Each call has an independent fixture provider and API response. No socket,
  // customer account, model loop or retained conversation is needed.
  const replies = new Map<string, string[]>();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const callId: string = body.responseTiming.callId;
    const traceId: string = body.responseTiming.traceId;
    const responseList = replies.get(traceId)!;
    const answer = body.sourceClaimReview ? sourceClaimVerdictFixture(body) : responseList?.shift();
    if (!answer) throw new Error("Missing bounded call fixture");
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const encoder = new TextEncoder();
    let resolveResponse!: (response: Response) => void;
    const promise = new Promise<Response>(resolve => { resolveResponse = resolve; });
    const response = new EventEmitter() as EventEmitter & { destroyed: boolean; writeHead: (status: number, headers: Record<string, string>) => void; write: (text: string) => boolean; end: () => void };
    response.destroyed = false;
    response.writeHead = (status, headers) => resolveResponse(new Response(stream, { status, headers }));
    // Deliberately split every SSE event across byte chunks. Timing IDs must
    // survive the same parser used for real provider streams.
    response.write = text => { const bytes = encoder.encode(text), split = Math.max(1, Math.floor(bytes.length / 2));
      streamController.enqueue(bytes.slice(0, split)); streamController.enqueue(bytes.slice(split)); return true; };
    response.end = () => streamController.close();
    const router = { async *stream() {
      yield { type: "thinking", text: "Synthetic private processing" } as StreamChunk;
      yield { type: "delta", text: answer } as StreamChunk;
      yield { type: "done", usage: { provenance: "provider-final", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
        provider: "anthropic", model: "fixture", finishReason: "stop" } as StreamChunk;
    } } as unknown as ModelRouter;
    // This timing harness uses a synthetic authenticated org and admitted turn.
    // Dev/legacy requests deliberately cannot run private source phases. Actual
    // authorization, persistence and billing remain separate integration gates.
    const quota = { cappedSubject: () => undefined, check: async () => undefined,
      recordTokens: async () => undefined } as unknown as PlanQuotaService;
    void handleChatApiRequest({ pathname: "/v1/chat", method: "POST",
      headers: Object.fromEntries(new Headers(init?.headers).entries()), body }, response as unknown as ServerResponse, {
      router, config: { defaultProvider: "anthropic", mockMode: true, allowUnapprovedProvider: true, apiKeys: {} },
      serverConfig: { nodeEnv: "test", requireApiAuth: false, jobsWorkersEnabled: false, devMode: true },
      orgStore: {
        resolveAuth: async () => ({orgId: "00000000-0000-4000-8000-000000000001",
          orgName: "timing-fixture", plan: "enterprise", apiKeyId: "synthetic"}),
        getOrganization: async () => ({plan: "enterprise"})
      } as unknown as import("../server/orgStore").OrgStore,
      planQuota: quota,
      sourceTurnAuthority: {
        admit: async ({check}) => {
          await check(quota, traceId, body.sourceClaimReview === true || body.sourceEvidenceRepair === true, new Date());
          return {id: traceId, source: true};
        }, complete: async () => undefined, close: async () => undefined
      }
    }).catch(error => { streamController.error(error); });
    if (!callId) throw new Error("Uncorrelated fixture request");
    return promise;
  };
  const secrets = { get: async () => "synthetic-test-token", store: async () => undefined, delete: async () => undefined };
  const results: WorkloadResult[] = [];
  let sequence = 0;
  try {
    for (const concurrency of [1, 4]) {
      for (const family of families) for (const volume of volumes) {
        // Explicit fixture cache, bounded to six files and cleared per workload.
        const caches = Array.from({ length: concurrency }, () => new Map<string, KnowledgeGapsEvidence>());
        for (const cacheMode of ["fixture-cold", "fixture-warm"] as const) {
          const tasks = Array.from({ length: concurrency }, async (_unused, slot) => {
            const cache = caches[slot];
            const cacheHit = cache.has("bounded");
            const events: ResponseTimingEvent[] = [], controller = new AbortController();
            const traceId = `harness-${++sequence}`;
            const trace = new ResponseTimingTrace({ traceId }, e => events.push(e));
            registerResponseTiming(controller.signal, trace);
            const endGather = trace.span("evidence");
            const evidence = cache.get("bounded") ?? { focusFiles: Array.from({ length: volume.files }, (_, index) => ({
              path: index === 0 ? family.path : `evidence/${index}.txt`, repoId: "github:fixture/source", branch: "frozen-ref",
              content: index === 0 ? family.source + "\n" + " ".repeat(volume.padding) : " ".repeat(volume.padding),
              startLine: 1, truncated: volume.padding > 0
            })) };
            cache.set("bounded", evidence); endGather();
            const quote = `\`\`\`1:${family.source.split("\n").length}:${family.path}\n${family.source}\n\`\`\``;
            const answer = `**Source-grounded review**\n\nWhen this check is reached, both conditions are required for the shown rejection.\n\n${quote}\n\n**Open questions**\n\nWhat happens inside the called implementation? Its body is not attached.`;
            const scenario = sequence % 3 === 0 ? "repair-invalid-quote" : "valid";
            replies.set(traceId, scenario === "valid" ? [answer] : [answer.replace(quote, quote.replace("reject", "invented")), answer]);
            const api = new SecureApiClient(secrets as never);
            const request: StreamChatParams = { message: `${KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER}\nDescribe the shown conditional check and leave the called implementation unknown.\n` + evidence.focusFiles!.map(f => f.content).join("\n"),
              context: {}, history: [], model: "fixture", provider: "anthropic", useCase: "knowledge_gaps", maxTokens: 4096, temperature: 0.5, enableThinking: true };
            let publicationMs: number | null = null;
            const final = await streamSourceReviewedKnowledgeGaps({ stream: api.streamChat.bind(api), request, evidence,
              baseUrl: "https://synthetic.invalid", signal: controller.signal, onChunk: () => { publicationMs = trace.elapsedMs(); },
              onValidated: () => undefined });
            const endPublication = trace.span("publication-validation");
            const checked = verifySourceCitationQuotes(final.message.content, evidence.focusFiles); endPublication(); trace.finish("completed");
            results.push({ workload: { language: family.language, structure: family.structure, evidence: volume.label,
              files: volume.files, sourceChars: evidence.focusFiles!.reduce((sum, file) => sum + (file.content?.length ?? 0), 0), cache: cacheMode, cacheHit, concurrency, scenario },
              mode: "harness-synthetic-provider", timings: { publicationMs, hostCompletionMs: trace.elapsedMs(),
                firstVisibleAnswerContentMs: null, firstUsefulSupportedAnswerMs: null, displayCompletionMs: null },
              quality: { sourceRef: "pass", citationIntegrity: checked.invalidQuotes === 0 && checked.verifiedQuotes === 1 ? "pass" : "fail",
                supportedClaims: "pass", truthfulUnknowns: "pass", requestedTask: "pass", adjudication: "fixture-author-review" }, events });
            replies.delete(traceId);
          });
          await Promise.all(tasks);
        }
      }
    }
    // Exact source bytes cannot certify a fabricated surrounding claim. Keep
    // this as a failed quality control even when the mechanical quote gate passes.
    const control = { ...results[0], workload: { ...results[0].workload, scenario: "exact-quote-unsupported-prose" },
      quality: { ...results[0].quality, supportedClaims: "fail" as const, truthfulUnknowns: "fail" as const, requestedTask: "fail" as const }, events: [] };
    const source = families[0].source;
    const unsupported = `Every request is race-free.\n\n\`\`\`1:1:${families[0].path}\n${source}\n\`\`\``;
    if (verifySourceCitationQuotes(unsupported, [{ path: families[0].path, content: source, startLine: 1 }]).invalidQuotes) throw new Error("Quality control quote must be exact");
    // Control is not a measured turn: do not copy another sample's durations.
    control.timings = { publicationMs: null, hostCompletionMs: null, firstVisibleAnswerContentMs: null, firstUsefulSupportedAnswerMs: null, displayCompletionMs: null };
    results.push(control);
    return { schemaVersion: 1, applicability: "Synthetic provider, in-memory API transport and fixture cache. Source-review/publication owners are real. No real provider, remote index, frontend display, useful-answer SLO, percentile or general latency claim is established.", results };
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[1]?.endsWith("responseWorkloadEvaluation.ts")) {
  void evaluateResponseWorkloads().then(report => {
    const output = process.argv[2];
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ samples: report.results.length - 1, qualityControl: report.results.at(-1)?.quality,
      mode: "harness-synthetic-provider", output: output ?? null }));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
