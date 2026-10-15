import assert from "node:assert/strict";
import test from "node:test";
import {supportsStructuredSourceReview} from "./sourceClaimReviewPolicy";

test("native source-review schema is enabled only for qualified catalog contracts",()=>{
  assert(supportsStructuredSourceReview("openai","gpt-5.5"));
  for(const model of ["claude-sonnet-4-6","claude-opus-4-8","claude-haiku-4-5-20251001"])assert(supportsStructuredSourceReview("anthropic",model));
});

test("unqualified providers and future model contracts do not receive a native schema",()=>{
  assert(!supportsStructuredSourceReview("anthropic","unqualified-future-model"));
  assert(!supportsStructuredSourceReview("openai","claude-sonnet-4-6"));
  assert(!supportsStructuredSourceReview("openai","gpt-future"));
  assert(!supportsStructuredSourceReview("gemini","gemini-2.5-pro"));
});
