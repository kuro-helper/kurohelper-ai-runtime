/**
 * Fail-open client for the optional long-term memory service.
 * Recall is tightly bounded; extraction is submitted after Discord delivery.
 */

"use strict";

function parseEnabled(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanInline(value, limit = 1000) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeMemoryEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .slice(0, 10)
    .map((entry) => ({
      id: cleanInline(entry?.id, 100),
      key: cleanInline(entry?.key, 160),
      summary: cleanInline(entry?.summary || entry?.value, 1000),
      category: cleanInline(entry?.category, 40),
      scope: entry?.scope === "global" ? "global" : "channel",
      scopeId: cleanInline(entry?.scope_id || entry?.scopeId, 100),
      participants: (Array.isArray(entry?.participants)
        ? entry.participants
        : []
      )
        .slice(0, 25)
        .map((participant) => ({
          id: cleanInline(participant?.id, 120),
          displayName: cleanInline(
            participant?.display_name || participant?.displayName,
            100,
          ),
          role: cleanInline(participant?.role, 32),
        }))
        .filter((participant) => participant.id),
      score: Math.max(0, Math.min(Number(entry?.score) || 0, 1)),
    }))
    .filter((entry) => entry.id && entry.summary && entry.category);
}

function normalizeRecentMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-20)
    .map((message) => {
      const reply = message?.replyTo;
      return {
        id: cleanInline(message?.id, 100),
        user_id: cleanInline(message?.userId, 100),
        display_name: cleanInline(message?.displayName, 100),
        content: String(message?.content || "")
          .trim()
          .slice(0, 1500),
        assistant: message?.assistant === true,
        created_at: String(message?.createdAt || "").slice(0, 100),
        reply_to:
          reply && typeof reply === "object"
            ? {
                message_id: cleanInline(reply.messageId, 100),
                user_id: cleanInline(reply.userId, 100),
                display_name: cleanInline(reply.displayName, 100),
                content: cleanInline(reply.content, 300),
                assistant: reply.assistant === true,
                image_count: Math.max(
                  0,
                  Math.min(Number(reply.imageCount) || 0, 10),
                ),
                unavailable: reply.unavailable === true,
              }
            : null,
      };
    })
    .filter((message) => message.id && message.display_name && message.content);
}

function createMemoryClient(options = {}) {
  const enabled =
    options.enabled ?? parseEnabled(process.env.MEMORY_ENABLED, false);
  const baseUrl = String(
    options.baseUrl ||
      process.env.MEMORY_SERVICE_URL ||
      "http://memory-service:8090",
  ).replace(/\/+$/, "");
  const timeoutMs = positiveInt(
    options.timeoutMs || process.env.MEMORY_RECALL_TIMEOUT_MS,
    500,
  );
  const characterId = String(
    options.characterId || process.env.MEMORY_CHARACTER_ID || "Kuro",
  );
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const channelWriteTails = new Map();

  function channelKey(channelId) {
    return String(channelId || "__global__");
  }

  async function post(path, body, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`memory service returned HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function recall({
    query,
    limit = 5,
    channelId = "",
    participantIds = [],
  }) {
    if (!enabled || !String(query || "").trim()) {
      return { context: "", memories: [], elapsedMs: 0 };
    }
    const startedAt = Date.now();
    try {
      const result = await post(
        "/v1/recall",
        {
          character_id: characterId,
          query: String(query),
          limit: Math.max(1, Math.min(Number(limit) || 5, 10)),
          channel_id: String(channelId || ""),
          participant_ids: Array.isArray(participantIds)
            ? [...new Set(participantIds.map(String).filter(Boolean))].slice(
                0,
                25,
              )
            : [],
        },
        timeoutMs,
      );
      return {
        context: String(result?.context || "").slice(0, 8_000),
        memories: normalizeMemoryEntries(result?.memories),
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      log(
        "warn",
        `[Memory] Recall skipped after ${Date.now() - startedAt} ms: ${error.message}`,
      );
      return { context: "", memories: [], elapsedMs: Date.now() - startedAt };
    }
  }

  function rememberTurn(turn) {
    if (!enabled || !turn?.userId || !turn?.userText || !turn?.assistantText) {
      return Promise.resolve(false);
    }
    const key = channelKey(turn.channelId);
    const previous = channelWriteTails.get(key) || Promise.resolve();
    const current = previous.then(async () => {
      try {
        return await post(
          "/v1/turns",
          {
            request_id: String(turn.requestId || ""),
            character_id: characterId,
            user_id: String(turn.userId),
            channel_id: String(turn.channelId || ""),
            display_name: String(turn.displayName || ""),
            mentioned_users: Array.isArray(turn.mentionedUsers)
              ? turn.mentionedUsers.slice(0, 25).map((user) => ({
                  id: String(user?.id || ""),
                  display_name: String(user?.displayName || ""),
                }))
              : [],
            context_participants: Array.isArray(turn.contextParticipants)
              ? turn.contextParticipants
                  .slice(0, 25)
                  .map((user) => ({
                    id: String(user?.id || ""),
                    display_name: String(user?.displayName || ""),
                  }))
                  .filter((user) => user.id)
              : [],
            recent_messages: normalizeRecentMessages(turn.recentMessages),
            user_text: String(turn.userText),
            assistant_text: String(turn.assistantText),
          },
          65_000,
        );
      } catch (error) {
        log("warn", `[Memory] Background write skipped: ${error.message}`);
        return false;
      }
    });
    channelWriteTails.set(key, current);
    current.finally(() => {
      if (channelWriteTails.get(key) === current) channelWriteTails.delete(key);
    });
    return current;
  }

  async function manage(
    path,
    body = {},
    requestTimeoutMs = Math.max(2_000, timeoutMs),
  ) {
    if (!enabled) {
      return { status: "disabled", memories: [], count: 0 };
    }
    try {
      return await post(
        `/v1/manage/${path}`,
        { character_id: characterId, ...body },
        requestTimeoutMs,
      );
    } catch (error) {
      log("warn", `[Memory] Management request failed: ${error.message}`);
      return { status: "unavailable", memories: [], count: 0 };
    }
  }

  async function listMemories({
    status = "active",
    limit = 20,
    offset = 0,
  } = {}) {
    const selectedStatus = ["active", "pending", "deleted"].includes(status)
      ? status
      : "active";
    return manage("list", {
      status: selectedStatus,
      limit: Math.max(1, Math.min(Number(limit) || 20, 50)),
      offset: Math.max(0, Math.min(Number(offset) || 0, 1_000_000)),
    });
  }

  async function getMemory(memoryId) {
    return manage("get", { memory_id: String(memoryId || "") });
  }

  async function forgetMemory(memoryId) {
    return manage("forget", { memory_id: String(memoryId || "") });
  }

  async function restoreMemory(memoryId) {
    return manage("restore", { memory_id: String(memoryId || "") });
  }

  async function resolveMemory(memoryId, resolution) {
    return manage("resolve", {
      memory_id: String(memoryId || ""),
      resolution: String(resolution || ""),
    });
  }

  async function clearMemories() {
    return manage("clear");
  }

  async function listBackups({ limit = 20, offset = 0 } = {}) {
    return manage(
      "backups",
      {
        limit: Math.max(1, Math.min(Number(limit) || 20, 50)),
        offset: Math.max(0, Math.min(Number(offset) || 0, 1_000_000)),
      },
      10_000,
    );
  }

  async function createBackup() {
    return manage("backup", {}, 30_000);
  }

  async function restoreBackup(backupId) {
    return manage(
      "restore-backup",
      { backup_id: String(backupId || "") },
      120_000,
    );
  }

  return {
    recall,
    rememberTurn,
    listMemories,
    getMemory,
    forgetMemory,
    restoreMemory,
    resolveMemory,
    clearMemories,
    listBackups,
    createBackup,
    restoreBackup,
    enabled,
    characterId,
  };
}

const defaultClient = createMemoryClient();

module.exports = {
  createMemoryClient,
  recallMemories: defaultClient.recall,
  rememberTurn: defaultClient.rememberTurn,
  listMemories: defaultClient.listMemories,
  getMemory: defaultClient.getMemory,
  forgetMemory: defaultClient.forgetMemory,
  restoreMemory: defaultClient.restoreMemory,
  resolveMemory: defaultClient.resolveMemory,
  clearMemories: defaultClient.clearMemories,
  listBackups: defaultClient.listBackups,
  createBackup: defaultClient.createBackup,
  restoreBackup: defaultClient.restoreBackup,
};
