import assert from "node:assert/strict";
import { parseOpenAiRetryAfterMs } from "../api/networkResilience";
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MAX_TOKENS_PER_REQUEST,
  estimateEmbeddingTokens,
  splitEmbeddingBatches
} from "./embeddingsClient";

void (async () => {
  assert.equal(parseOpenAiRetryAfterMs("Please try again in 20s"), 20_000);
  assert.equal(parseOpenAiRetryAfterMs("Please try again in 1.5s"), 1_500);
  assert.equal(parseOpenAiRetryAfterMs("rate limited"), undefined);

  const chunk = "x".repeat(2048);
  assert.equal(estimateEmbeddingTokens(chunk), 512);

  const smallBatch = Array.from({ length: 10 }, () => "short");
  assert.equal(splitEmbeddingBatches(smallBatch).length, 1);

  const countLimited = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, () => "a");
  const countBatches = splitEmbeddingBatches(countLimited);
  assert.equal(countBatches.length, 2);
  assert.equal(countBatches[0].length, EMBEDDING_BATCH_SIZE);
  assert.equal(countBatches[1].length, 1);

  const heavy = Array.from({ length: 80 }, () => "z".repeat(2048));
  const tokenBatches = splitEmbeddingBatches(heavy);
  for (const batch of tokenBatches) {
    const tokens = batch.reduce((sum, text) => sum + estimateEmbeddingTokens(text), 0);
    assert.ok(tokens <= EMBEDDING_MAX_TOKENS_PER_REQUEST);
  }
  assert.ok(tokenBatches.length > 1);

  console.log("embeddingsClient: 1/1 tests passed");
})();
