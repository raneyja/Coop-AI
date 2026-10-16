import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicProviderClient, applyAnthropicThinking, buildAnthropicInferenceBody, parseAnthropicLine } from "./anthropicClient";
import type { ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

const options: ProviderStreamOptions = {model:"claude-sonnet-4-6",temperature:0.5,maxTokens:16000,
  messages:[{role:"user",content:"fixture"}],requestId:"protocol-control"};
const event = (value: unknown) => "data: " + JSON.stringify(value) + "\n\n";
const start = event({type:"message_start",message:{usage:{input_tokens:32}}});
const text = event({type:"content_block_delta",delta:{type:"text_delta",text:"Complete ✅"}});
const ending = (reason: string) => event({type:"message_delta",delta:{stop_reason:reason},usage:{output_tokens:3}});
const stop = event({type:"message_stop"});
async function streamFixture(body: string): Promise<StreamChunk[]> {
  const bytes=new TextEncoder().encode(body);
  const client=new AnthropicProviderClient("anthropic",{apiKey:"test-only",fetchImpl:async()=>new Response(new ReadableStream({
    start(controller){for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7));controller.close();}
  }))});
  const chunks:StreamChunk[]=[];
  for await(const chunk of client.streamCompletion(options))chunks.push(chunk);
  return chunks;
}

test("a complete Anthropic stream preserves split UTF-8, final unnewline-terminated event and actual usage",async()=>{
  const chunks=await streamFixture(start+text+ending("end_turn")+stop.trimEnd());
  assert.deepEqual(chunks.filter(chunk=>chunk.type==="delta"),[{type:"delta",text:"Complete ✅"}]);
  const done=chunks.find(chunk=>chunk.type==="done");assert.equal(done?.finishReason,"stop");
  assert.equal(done?.usage.inputTokens,32);assert.equal(done?.usage.outputTokens,3);
  assert(!chunks.some(chunk=>chunk.type==="error"));
});

test("complete-looking text without message_stop or stop reason cannot masquerade as successful completion",async()=>{
  for(const body of [start+text+ending("end_turn"),start+text+stop,start+text]){
    const chunks=await streamFixture(body);const done=chunks.find(chunk=>chunk.type==="done");
    assert.equal(done?.finishReason,"error");assert.equal(done?.usage.inputTokens,32);
    assert(chunks.some(chunk=>chunk.type==="error"));
    assert(!chunks.some(chunk=>chunk.type==="done"&&chunk.finishReason==="stop"));
  }
});

test("in-stream Anthropic errors retain known usage and stop without fabricated success",async()=>{
  for(const finalNewline of [true,false]){
    let error=event({type:"error",error:{type:"overloaded_error",message:"Overloaded"}});
    if(!finalNewline)error=error.trimEnd();
    const chunks=await streamFixture(start+text+error);
    assert(chunks.some(chunk=>chunk.type==="error"&&chunk.code==="overloaded_error"));
    const done=chunks.find(chunk=>chunk.type==="done");assert.equal(done?.finishReason,"error");assert.equal(done?.usage.inputTokens,32);
    assert(!chunks.some(chunk=>chunk.type==="done"&&chunk.finishReason==="stop"));
  }
});

test("Anthropic stop reasons preserve capacity limits and reject unhandled continuations",async()=>{
  for(const [reason,expected] of [["max_tokens","length"],["model_context_window_exceeded","length"],["stop_sequence","stop"],["pause_turn","error"],["future_reason","error"]]){
    const chunks=await streamFixture(start+text+ending(reason)+stop);
    assert.equal(chunks.find(chunk=>chunk.type==="done")?.finishReason,expected,reason);
  }
});

test("read failure and user Stop retain measured usage with distinct terminal reasons",async()=>{
  for(const cancelled of [false,true]){
    const controller=new AbortController();let pulled=false;
    const client=new AnthropicProviderClient("anthropic",{apiKey:"test-only",fetchImpl:async()=>new Response(new ReadableStream({
      pull(stream){if(!pulled){pulled=true;stream.enqueue(new TextEncoder().encode(start+text));return;}
        if(cancelled)controller.abort();stream.error(new Error("transport interrupted"));}
    }))});
    const chunks:StreamChunk[]=[];
    for await(const chunk of client.streamCompletion({...options,signal:controller.signal}))chunks.push(chunk);
    const done=chunks.find(chunk=>chunk.type==="done");assert.equal(done?.finishReason,cancelled?"cancelled":"error");
    assert.equal(done?.usage.inputTokens,32);assert.equal(chunks.some(chunk=>chunk.type==="error"),!cancelled);
    assert(!chunks.some(chunk=>chunk.type==="done"&&chunk.finishReason==="stop"));
  }
});

function state(): ParseState {
  return { text: "" };
}

test("parseAnthropicLine yields thinking chunks from thinking_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Checking call sites…" }
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "thinking", text: "Checking call sites…" });
});

test("parseAnthropicLine yields answer deltas from text_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Hello" }
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "delta", text: "Hello" });
});

test("applyAnthropicThinking uses adaptive + effort for Opus 4.8", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-opus-4-8", stream: true },
    {
      model: "claude-opus-4-8",
      maxTokens: 16_000,
      thinking: { mode: "adaptive", effort: "high" }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "adaptive" });
  assert.deepEqual(applied.body.output_config, { effort: "high" });
  assert.equal(applied.forceTemperature, 1);
  const thinking = applied.body.thinking as { type?: string; budget_tokens?: number };
  assert.notEqual(thinking.type, "enabled");
  assert.equal(thinking.budget_tokens, undefined);
});

test("applyAnthropicThinking uses enabled + budget for Haiku 4.5", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-haiku-4-5-20251001", stream: true },
    {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 16_000,
      thinking: { mode: "extended", budgetTokens: 1024 }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "enabled", budget_tokens: 1024 });
  assert.equal(applied.body.output_config, undefined);
  assert.equal(applied.forceTemperature, 1);
  assert.equal(applied.maxTokens, 16_000);
});

test("applyAnthropicThinking uses adaptive for Sonnet 4.6", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-sonnet-4-6", stream: true },
    {
      model: "claude-sonnet-4-6",
      maxTokens: 16_000,
      thinking: { mode: "adaptive", effort: "high" }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "adaptive" });
  assert.deepEqual(applied.body.output_config, { effort: "high" });
  assert.equal(applied.forceTemperature, 1);
});

test("applyAnthropicThinking ignores OpenAI/Gemini thinking modes", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-opus-4-8" },
    {
      model: "claude-opus-4-8",
      maxTokens: 16_000,
      thinking: { mode: "openai-reasoning", effort: "medium" }
    }
  );
  assert.equal(applied.body.thinking, undefined);
  assert.equal(applied.forceTemperature, undefined);
});

test("buildAnthropicInferenceBody clamps chat temperature to 1 when thinking is on", () => {
  const body = buildAnthropicInferenceBody({
    formattedBody: { model: "claude-sonnet-4-6", temperature: 0.5, max_tokens: 16_000 },
    model: "claude-sonnet-4-6",
    maxTokens: 16_000,
    thinking: { mode: "adaptive", effort: "high" }
  });
  assert.equal(body.temperature, 1);
  assert.deepEqual(body.thinking, { type: "adaptive" });
});

test("buildAnthropicInferenceBody keeps custom temperature when thinking is off", () => {
  const body = buildAnthropicInferenceBody({
    formattedBody: { model: "claude-sonnet-4-6", temperature: 0.5, max_tokens: 16_000 },
    model: "claude-sonnet-4-6",
    maxTokens: 16_000
  });
  assert.equal(body.temperature, 0.5);
  assert.equal(body.thinking, undefined);
});

test("parseAnthropicLine ignores signature_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "abc" }
    })}`,
    state()
  );
  assert.equal(chunk, undefined);
});
