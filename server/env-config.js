"use strict";

function stringSetting(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function booleanSetting(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function numberSetting(env, name, fallback, { integer = false } = {}) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} must be ${integer ? "an integer" : "a number"}.`);
  }
  return parsed;
}

function createEnvConfig(env = process.env) {
  return {
    enabledPlugins: ["kurohelper"],
    wssPort: 2333,
    timezone: stringSetting(env, "TZ", "Asia/Taipei"),
    locale: stringSetting(env, "RUNTIME_LOCALE", "zh-TW"),
    userLocale: stringSetting(env, "RUNTIME_USER_LOCALE", "zh-TW"),
    debug: booleanSetting(env, "RUNTIME_DEBUG", false),
    queueTaskTimeoutSeconds: numberSetting(
      env,
      "RUNTIME_QUEUE_TASK_TIMEOUT_SECONDS",
      60,
    ),
    imagePlaceholderTimeoutSeconds: numberSetting(
      env,
      "RUNTIME_IMAGE_PLACEHOLDER_TIMEOUT_SECONDS",
      180,
    ),
    dynamicContextTokenBudget: numberSetting(
      env,
      "RUNTIME_DYNAMIC_CONTEXT_TOKEN_BUDGET",
      1200,
      { integer: true },
    ),
    memorySoftTokenBudget: numberSetting(
      env,
      "RUNTIME_MEMORY_SOFT_TOKEN_BUDGET",
      400,
      { integer: true },
    ),
    streamResponses: booleanSetting(
      env,
      "RUNTIME_STREAM_RESPONSES",
      false,
    ),
    dialogueOnlyResponses: booleanSetting(
      env,
      "RUNTIME_DIALOGUE_ONLY_RESPONSES",
      false,
    ),
    autoCreatePersonas: booleanSetting(
      env,
      "RUNTIME_AUTO_CREATE_PERSONAS",
      true,
    ),
    kurohelperPersonaMap: {},
    kurohelperLanguageMap: {},
    externalPlugins: [],
    plugins: {
      kurohelper: {
        // KUROHELPER_BRIDGE_SECRET is read by the transport itself.
        secret: "",
        circuitBreaker: {
          enabled: booleanSetting(
            env,
            "RUNTIME_CIRCUIT_BREAKER_ENABLED",
            true,
          ),
          failureThreshold: numberSetting(
            env,
            "RUNTIME_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
            5,
            { integer: true },
          ),
          cooldownSeconds: numberSetting(
            env,
            "RUNTIME_CIRCUIT_BREAKER_COOLDOWN_SECONDS",
            30,
          ),
        },
      },
    },
  };
}

module.exports = {
  createEnvConfig,
};
