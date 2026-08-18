"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyGenerationOverrides,
  buildUpstreamUrl,
  claimRecords,
  requestRoute,
  parseSseEvents,
  routingFromPayload,
  shouldTrackGeneration,
  usageFromPayload,
  upstreamKind,
  normalizeCustomChatPayload,
  normalizeExampleMessages,
  requestHeaders,
} = require("./server");

test("memory extraction bypasses the main generation metrics pool", () => {
  assert.equal(
    shouldTrackGeneration("POST", "/v1/chat/completions", {
      "x-kuro-metrics-skip": "true",
    }),
    false,
  );
  assert.equal(
    shouldTrackGeneration("POST", "/v1/chat/completions", {}),
    true,
  );
});

test("applyGenerationOverrides forces reasoning off and requests usage", () => {
  assert.deepEqual(
    applyGenerationOverrides(
      {
        usage: { include: false },
        reasoning_effort: "high",
        include_reasoning: true,
      },
      { forceReasoningEffort: "none", providerSort: "latency" },
    ),
    {
      usage: { include: true },
      provider: { sort: "latency" },
      reasoning: { enabled: false, exclude: true },
    },
  );
});

test("applyGenerationOverrides preserves model-default reasoning", () => {
  assert.deepEqual(
    applyGenerationOverrides(
      { reasoning: { effort: "auto" } },
      { forceReasoningEffort: "", providerSort: "latency" },
    ),
    {
      usage: { include: true },
      provider: { sort: "latency" },
      reasoning: { effort: "auto" },
    },
  );
});

test("custom chat policy does not inject OpenRouter-only request fields", () => {
  assert.deepEqual(
    applyGenerationOverrides(
      { model: "gpt-5.6-luna", reasoning_effort: "xhigh" },
      { forceReasoningEffort: "", providerSort: "", includeUsage: false },
    ),
    { model: "gpt-5.6-luna", reasoning_effort: "xhigh" },
  );
});

test("custom chat payload uses the gateway reasoning format", () => {
  assert.deepEqual(
    normalizeCustomChatPayload({
      model: "gpt-5.6-luna",
      reasoning: { effort: "max" },
      include_reasoning: false,
      provider: { sort: "latency" },
      usage: { include: true },
      max_tokens: 500,
      max_completion_tokens: 500,
      max_output_tokens: 500,
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
      logprobs: true,
      top_logprobs: 5,
      logit_bias: { 42: 1 },
      seed: 42,
      stop: ["STOP"],
      n: 1,
    }),
    {
      model: "gpt-5.6-luna",
      reasoning_effort: "xhigh",
    },
  );
});

test("custom chat payload drops unsupported automatic effort", () => {
  assert.deepEqual(
    normalizeCustomChatPayload({ reasoning: { effort: "auto" } }),
    {},
  );
});

test("custom chat payload converts SillyTavern named examples for Responses", () => {
  assert.deepEqual(
    normalizeCustomChatPayload({
      messages: [
        { role: "system", content: "[Example Chat]" },
        { role: "system", name: "example_user", content: "你好" },
        { role: "system", name: "example_assistant", content: "……嗯。" },
        { role: "system", content: "[Example Chat]" },
        { role: "user", name: "Tommy", content: "在嗎？" },
        {
          role: "user",
          name: "肉圓",
          content: [{ type: "image_url", image_url: { url: "https://example.test/a.png" } }],
        },
      ],
    }),
    {
      messages: [
        {
          role: "system",
          content: "[範例對話]\n以下內容只用於示範角色的說話風格，未曾實際發生；不是近期對話、使用者記憶或共同經歷。",
        },
        { role: "user", content: "Example User: 你好" },
        { role: "assistant", content: "Example Assistant: ……嗯。" },
        { role: "system", content: "[範例對話續]" },
        { role: "user", content: "Tommy: 在嗎？" },
        {
          role: "user",
          content: [
            { type: "text", text: "肉圓:" },
            { type: "image_url", image_url: { url: "https://example.test/a.png" } },
          ],
        },
      ],
    },
  );
});

test("example provenance is also normalized without rewriting ordinary names", () => {
  assert.deepEqual(
    normalizeExampleMessages({
      messages: [
        { role: "system", content: "[Example Chat]" },
        { role: "system", name: "example_user", content: "測試問題" },
        { role: "system", name: "example_assistant", content: "測試回答" },
        { role: "user", name: "Tommy", content: "真實訊息" },
      ],
    }),
    {
      messages: [
        {
          role: "system",
          content: "[範例對話]\n以下內容只用於示範角色的說話風格，未曾實際發生；不是近期對話、使用者記憶或共同經歷。",
        },
        { role: "user", content: "Example User: 測試問題" },
        { role: "assistant", content: "Example Assistant: 測試回答" },
        { role: "user", name: "Tommy", content: "真實訊息" },
      ],
    },
  );
});

test("buildUpstreamUrl preserves the OpenAI-compatible path and query", () => {
  assert.equal(
    buildUpstreamUrl("/v1/models?input_modalities=text"),
    "https://ai-api.aluo.work/v1/models?input_modalities=text",
  );
  assert.equal(
    buildUpstreamUrl(
      "/v1/models?input_modalities=text",
      "https://openrouter.ai/api/v1",
    ),
    "https://openrouter.ai/api/v1/models?input_modalities=text",
  );
});

test("worker route is stripped before forwarding and retains attribution", () => {
  assert.deepEqual(requestRoute("/worker/worker-2/v1/models?x=1"), {
    url: new URL("http://metrics-proxy.invalid/v1/models?x=1"),
    workerId: "worker-2",
  });
  assert.equal(
    buildUpstreamUrl("/worker/worker-2/v1/chat/completions"),
    "https://ai-api.aluo.work/v1/chat/completions",
  );
});

test("internal upstream marker selects OpenRouter without trusting other values", () => {
  assert.equal(upstreamKind({}), "chat");
  assert.equal(upstreamKind({ "x-kuro-upstream": "openrouter" }), "openrouter");
  assert.equal(upstreamKind({ "x-kuro-upstream": "unexpected" }), "chat");
});

test("internal routing headers are not forwarded upstream", () => {
  const headers = requestHeaders({
    headers: {
      authorization: "Bearer test",
      "x-kuro-upstream": "openrouter",
      "x-kuro-metrics-skip": "true",
    },
  });
  assert.equal(headers.get("authorization"), "Bearer test");
  assert.equal(headers.has("x-kuro-upstream"), false);
  assert.equal(headers.has("x-kuro-metrics-skip"), false);
});

test("metrics claims only records belonging to the requesting worker", () => {
  const records = [
    { generationId: "a", workerId: "worker-1", startedAt: 100, claimed: false },
    { generationId: "b", workerId: "worker-2", startedAt: 100, claimed: false },
  ];
  assert.deepEqual(
    claimRecords(0, "worker-2", records).map((record) => record.generationId),
    ["b"],
  );
  assert.equal(records[0].claimed, false);
  assert.equal(records[1].claimed, true);
});

test("parseSseEvents handles a usage-only final event", () => {
  const payloads = [];
  const state = { buffer: "" };
  parseSseEvents(
    state,
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.01}}\n\n',
    (payload) => payloads.push(payload),
  );
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].choices[0].delta.content, "hi");
  assert.equal(usageFromPayload(payloads[1]).costUsd, 0.01);
});

test("usageFromPayload extracts reasoning and cache details", () => {
  assert.deepEqual(
    usageFromPayload({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
        cost: 0.002,
        prompt_tokens_details: { cached_tokens: 25 },
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    }),
    {
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
      reasoningTokens: 7,
      cachedTokens: 25,
      costUsd: 0.002,
    },
  );
});

test("routingFromPayload extracts the selected OpenRouter provider", () => {
  assert.deepEqual(
    routingFromPayload({
      openrouter_metadata: {
        strategy: "direct",
        region: "iad",
        attempt: 2,
        endpoints: {
          available: [
            { provider: "Provider A", model: "model-a", selected: false },
            { provider: "Provider B", model: "model-b", selected: true },
          ],
        },
        attempts: [
          { provider: "Provider A", model: "model-a", status: 502 },
          { provider: "Provider B", model: "model-b", status: 200 },
        ],
      },
    }),
    {
      provider: "Provider B",
      providerModel: "model-b",
      routingStrategy: "direct",
      routingRegion: "iad",
      routingAttempt: 2,
    },
  );
});

test("routingFromPayload falls back to the legacy provider field", () => {
  assert.equal(routingFromPayload({ provider: "Legacy Provider" }).provider, "Legacy Provider");
});
