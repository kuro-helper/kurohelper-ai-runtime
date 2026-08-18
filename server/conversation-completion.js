"use strict";

const { sanitizeModelOutput } = require("./output-sanitizer");

async function providerMetricsFor(data, claimProviderMetrics) {
  return typeof claimProviderMetrics === "function"
    ? claimProviderMetrics(data.receivedAt)
    : { generationCount: 0, usageAvailable: false };
}

async function handleAIReply(data, deps) {
  const {
    fanout,
    rememberTurn,
    claimProviderMetrics,
    log,
  } = deps;
  const conversationId = data.chatId;
  const providerMetrics = await providerMetricsFor(data, claimProviderMetrics);
  const metrics = { ...(data.metrics || {}), ...providerMetrics };
  const messages =
    data?.messages || (data?.text ? [{ name: "", text: data.text }] : []);
  const deliverable = messages
    .map((message) => sanitizeModelOutput(message?.text))
    .filter(Boolean);

  if (deliverable.length === 0) {
    await fanout(
      conversationId,
      "sendText",
      "模型沒有產生可用的回覆，請再試一次。",
      {
        kind: "error",
        requestId: data.requestId || "",
        final: true,
        metrics,
      },
    );
    return;
  }

  for (let index = 0; index < deliverable.length; index += 1) {
    await fanout(conversationId, "sendText", deliverable[index], {
      kind: "ai_reply",
      requestId: data.requestId || "",
      final: index === deliverable.length - 1,
      metrics,
    });
  }

  if (
    typeof rememberTurn !== "function" ||
    !data.userId ||
    !data.userText
  ) {
    return;
  }

  Promise.resolve(
    rememberTurn({
      requestId: data.requestId || "",
      userId: data.userId,
      channelId: conversationId,
      displayName: data.displayName || "",
      mentionedUsers: data.mentionedUsers || [],
      contextParticipants: data.contextParticipants || [],
      recentMessages: data.recentMessages || [],
      userText: data.userText,
      assistantText: deliverable.join("\n\n"),
    }),
  )
    .then((result) => {
      if (!result?.metrics) return null;
      const sourceRequestId = String(data.requestId || "");
      return fanout(conversationId, "sendMetric", {
        requestId: `${sourceRequestId}:memory`,
        sourceRequestId,
        operation: "memory_extraction",
        metrics: result.metrics,
      });
    })
    .catch((error) =>
      log("warn", `[Memory] Could not submit turn: ${error.message}`),
    );
}

async function handleTerminalMessage(data, deps) {
  const { fanout, claimProviderMetrics } = deps;
  const providerMetrics = await providerMetricsFor(
    data,
    claimProviderMetrics,
  );
  if (!data?.text?.trim()) return;
  await fanout(data.chatId, "sendText", data.text.trim(), {
    kind: "error",
    requestId: data.requestId || "",
    final: true,
    metrics: { ...(data.metrics || {}), ...providerMetrics },
  });
}

module.exports = { handleAIReply, handleTerminalMessage };
