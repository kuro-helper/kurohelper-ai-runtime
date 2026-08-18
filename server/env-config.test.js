"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnvConfig } = require("./env-config");

test("createEnvConfig exposes recommended runtime defaults", () => {
  const config = createEnvConfig({});

  assert.equal(config.timezone, "Asia/Taipei");
  assert.equal(config.locale, "zh-TW");
  assert.equal(config.userLocale, "zh-TW");
  assert.equal(config.queueTaskTimeoutSeconds, 60);
  assert.equal(config.dynamicContextTokenBudget, 1200);
  assert.equal(config.memorySoftTokenBudget, 400);
  assert.equal(config.streamResponses, false);
  assert.equal(config.dialogueOnlyResponses, false);
  assert.equal(config.autoCreatePersonas, true);
  assert.equal(config.plugins.kurohelper.circuitBreaker.failureThreshold, 5);
});

test("createEnvConfig parses explicit environment overrides", () => {
  const config = createEnvConfig({
    TZ: "UTC",
    RUNTIME_LOCALE: "en-US",
    RUNTIME_DEBUG: "true",
    RUNTIME_QUEUE_TASK_TIMEOUT_SECONDS: "90",
    RUNTIME_DYNAMIC_CONTEXT_TOKEN_BUDGET: "1500",
    RUNTIME_MEMORY_SOFT_TOKEN_BUDGET: "350",
    RUNTIME_STREAM_RESPONSES: "false",
    RUNTIME_DIALOGUE_ONLY_RESPONSES: "true",
    RUNTIME_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "7",
  });

  assert.equal(config.timezone, "UTC");
  assert.equal(config.locale, "en-US");
  assert.equal(config.debug, true);
  assert.equal(config.queueTaskTimeoutSeconds, 90);
  assert.equal(config.dynamicContextTokenBudget, 1500);
  assert.equal(config.memorySoftTokenBudget, 350);
  assert.equal(config.dialogueOnlyResponses, true);
  assert.equal(config.plugins.kurohelper.circuitBreaker.failureThreshold, 7);
});

test("createEnvConfig rejects malformed typed values", () => {
  assert.throws(
    () => createEnvConfig({ RUNTIME_DEBUG: "yes" }),
    /RUNTIME_DEBUG must be true or false/,
  );
  assert.throws(
    () =>
      createEnvConfig({ RUNTIME_DYNAMIC_CONTEXT_TOKEN_BUDGET: "1200.5" }),
    /must be an integer/,
  );
});
