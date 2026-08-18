import { formatDialogueOnly } from './dialogue-only.mjs';

function cleanInline(value, limit) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function normalizeDiscordReplyReference(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const assistant = reply.assistant === true;
  const rawContent = cleanInline(reply.content, 500);
  const content = assistant
    ? cleanInline(formatDialogueOnly(rawContent), 300)
    : rawContent.slice(0, 300);
  const normalized = {
    messageId: cleanInline(reply.messageId, 100),
    userId: cleanInline(reply.userId, 100),
    displayName: cleanInline(
      reply.displayName || (assistant ? 'Kuro' : 'Discord 使用者'),
      100,
    ),
    content,
    assistant,
    imageCount: Math.max(0, Math.min(Number(reply.imageCount) || 0, 10)),
    unavailable: reply.unavailable === true,
  };
  if (!normalized.unavailable && !normalized.messageId
    && !normalized.content && normalized.imageCount === 0) return null;
  return normalized;
}

export function formatDiscordReplyLabel(reply) {
  const normalized = normalizeDiscordReplyReference(reply);
  if (!normalized) return '';
  if (normalized.unavailable) return '回覆一則已無法取得的訊息';
  const speaker = normalized.displayName || 'Discord 使用者';
  if (normalized.content) return `回覆 ${speaker} 的「${normalized.content}」`;
  if (normalized.imageCount > 0) return `回覆 ${speaker} 的圖片訊息`;
  return `回覆 ${speaker} 的訊息`;
}
