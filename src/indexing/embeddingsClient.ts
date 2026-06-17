import { loadLlmServerConfig } from "../api/llmServerConfig";
import { NetworkResilienceError, runResilientRequest } from "../api/networkResilience";
import { withEmbeddingConcurrencyLimit } from "./embeddingRateLimiter";
import { MAX_CHUNK_CHARS } from "./treeSitterChunker";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** Max inputs per embeddings request — reduced from 512 for TPM safety on large monorepos. */
export const EMBEDDING_BATCH_SIZE = 64;

/** Rough token budget per request (~50K tokens) to stay under OpenAI TPM limits. */
export const EMBEDDING_MAX_TOKENS_PER_REQUEST = 50_000;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

const EMBEDDING_RETRY_POLICY = {
  maxRetries: 7,
  backoffMs: 2_000,
  exponentialBackoff: true,
  retryOn: [408, 429, 500, 502, 503, 504],
  dontRetryOn: [401, 403]
};

type OpenAiEmbeddingsResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
};

export type EmbedTextsOptions = {
  /** When set, bulk indexing serializes across workers via Postgres advisory locks. */
  pool?: import("pg").Pool;
};

export function estimateEmbeddingTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function splitEmbeddingBatches(texts: string[]): string[][] {
  if (texts.length === 0) {
    return [];
  }

  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateEmbeddingTokens(text);
    const wouldExceedCount = current.length >= EMBEDDING_BATCH_SIZE;
    const wouldExceedTokens =
      current.length > 0 && currentTokens + tokens > EMBEDDING_MAX_TOKENS_PER_REQUEST;

    if (wouldExceedCount || wouldExceedTokens) {
      batches.push(current);
      current = [text];
      currentTokens = tokens;
      continue;
    }

    current.push(text);
    currentTokens += tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

export async function embedTexts(texts: string[], options: EmbedTextsOptions = {}): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const apiKey = loadLlmServerConfig().apiKeys.openai?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Lightning Mode embedding indexing");
  }

  const runBatches = async (): Promise<number[][]> => {
    const results: number[][] = new Array(texts.length);
    let offset = 0;
    for (const batch of splitEmbeddingBatches(texts)) {
      const batchEmbeddings = await requestEmbeddings(apiKey, batch);
      for (let i = 0; i < batchEmbeddings.length; i += 1) {
        results[offset + i] = batchEmbeddings[i];
      }
      offset += batch.length;
    }
    return results;
  };

  if (options.pool) {
    return withEmbeddingConcurrencyLimit(options.pool, apiKey, runBatches);
  }
  return runBatches();
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding) {
    throw new Error("Embedding API returned no vector for query");
  }
  return embedding;
}

async function requestEmbeddings(apiKey: string, inputs: string[]): Promise<number[][]> {
  return runResilientRequest({
    policy: EMBEDDING_RETRY_POLICY,
    timeoutMs: 120_000,
    run: async (signal) => {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: inputs,
          dimensions: EMBEDDING_DIMENSIONS
        }),
        signal
      });

      const body = (await response.json()) as OpenAiEmbeddingsResponse;
      if (!response.ok) {
        const message = body.error?.message ?? `OpenAI embeddings returned ${response.status}`;
        throw new NetworkResilienceError(message, body, response.status);
      }

      const rows = body.data ?? [];
      if (rows.length !== inputs.length) {
        throw new Error(
          `OpenAI embeddings returned ${rows.length} vectors for ${inputs.length} inputs`
        );
      }

      const ordered = new Array<number[]>(inputs.length);
      for (const row of rows) {
        const index = row.index ?? ordered.findIndex((value) => value === undefined);
        const embedding = row.embedding;
        if (index < 0 || index >= inputs.length || !embedding) {
          throw new Error("OpenAI embeddings response missing vector data");
        }
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Expected ${EMBEDDING_DIMENSIONS}-dimensional embedding, got ${embedding.length}`
          );
        }
        ordered[index] = embedding;
      }
      if (ordered.some((value) => !value)) {
        throw new Error("OpenAI embeddings response did not cover all input indices");
      }
      return ordered;
    }
  });
}

/** Exported for tests — upper bound used when estimating worst-case chunk token load. */
export const EMBEDDING_MAX_CHARS_PER_CHUNK = MAX_CHUNK_CHARS;
