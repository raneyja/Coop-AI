import { loadLlmServerConfig } from "../api/llmServerConfig";
import { NetworkResilienceError, runResilientRequest } from "../api/networkResilience";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** OpenAI allows up to 2048 inputs per embeddings request; stay well under for token limits. */
export const EMBEDDING_BATCH_SIZE = 512;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

type OpenAiEmbeddingsResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
};

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const apiKey = loadLlmServerConfig().apiKeys.openai?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Lightning Mode embedding indexing");
  }

  const results: number[][] = new Array(texts.length);
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await requestEmbeddings(apiKey, batch);
    for (let i = 0; i < batchEmbeddings.length; i += 1) {
      results[offset + i] = batchEmbeddings[i];
    }
  }
  return results;
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
