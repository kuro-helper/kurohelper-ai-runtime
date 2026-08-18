"use strict";

function applyGenerationPolicy(payload, options = {}) {
  const forceReasoningEffort = options.forceReasoningEffort ?? "";
  const providerSort = options.providerSort ?? "";
  const includeUsage = options.includeUsage ?? true;

  if (includeUsage) {
    payload.usage = { ...(payload.usage || {}), include: true };
  }
  if (providerSort) {
    payload.provider = { ...(payload.provider || {}), sort: providerSort };
  }
  if (forceReasoningEffort) {
    payload.reasoning = forceReasoningEffort === "none"
      ? { enabled: false, exclude: true }
      : { effort: forceReasoningEffort };
    delete payload.reasoning_effort;
    delete payload.include_reasoning;
  }
  return payload;
}

module.exports = { applyGenerationPolicy };
