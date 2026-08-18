/**
 * Temporarily hides persisted SillyTavern history from prompt construction.
 * The newest user message remains visible; Discord supplies recent context.
 */

import { formatDialogueOnly } from './dialogue-only.mjs';
import { formatDiscordReplyLabel } from './discord-reply.mjs';

export function suppressPreviousChatMessages(
  chat,
  ignoreSymbol = Symbol.for('ignore'),
) {
  if (!Array.isArray(chat) || chat.length === 0 || !chat.at(-1)?.is_user) {
    return () => {};
  }

  const changes = [];
  for (let index = 0; index < chat.length - 1; index++) {
    const message = chat[index];
    if (!message || typeof message !== 'object') continue;
    const hadExtra = Boolean(message.extra);
    message.extra ||= {};
    const hadOwnValue = Object.prototype.hasOwnProperty.call(
      message.extra,
      ignoreSymbol,
    );
    const previousValue = message.extra[ignoreSymbol];
    if (previousValue === true) continue;
    message.extra[ignoreSymbol] = true;
    changes.push({ message, hadExtra, hadOwnValue, previousValue });
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const { message, hadExtra, hadOwnValue, previousValue } of changes) {
      if (!message.extra) continue;
      if (hadOwnValue) message.extra[ignoreSymbol] = previousValue;
      else delete message.extra[ignoreSymbol];
      if (!hadExtra && Reflect.ownKeys(message.extra).length === 0) {
        delete message.extra;
      }
    }
  };
}

/**
 * Temporarily inserts Discord history as real SillyTavern chat turns. User
 * messages carry a speaker prefix because OpenAI-compatible chat roles do not
 * otherwise distinguish multiple Discord users. The injected objects are
 * removed after generation and are never saved as SillyTavern history.
 */
export function injectDiscordPromptHistory(
  chat,
  recentMessages = [],
  currentImageContext = '',
  { timeZone = 'Asia/Taipei', locale = 'zh-TW', currentReplyTo = null } = {},
) {
  if (!Array.isArray(chat) || chat.length === 0 || !chat.at(-1)?.is_user) {
    return () => {};
  }

  const currentMessage = chat.at(-1);
  const originalCurrentText = currentMessage.mes;
  const injected = (Array.isArray(recentMessages) ? recentMessages : [])
    .map((message) => {
      const assistant = message?.assistant === true;
      const displayName = String(
        message?.displayName || (assistant ? 'Kuro' : 'Discord 使用者'),
      ).trim();
      const rawContent = String(message?.content || '').trim();
      // Discord retains the text that was actually sent. Clean assistant
      // turns only while constructing the prompt so an old stage direction
      // cannot become a style example for subsequent generations.
      const content = assistant
        ? formatDialogueOnly(rawContent)
        : rawContent;
      if (!content) return null;
      const timestamp = formatDiscordHistoryTimestamp(
        message?.createdAt,
        timeZone,
        locale,
      );
      const timestampPrefix = timestamp ? `[${timestamp}]` : '';
      const replyLabel = formatDiscordReplyLabel(message?.replyTo);
      const speakerLabel = replyLabel
        ? `[${displayName}｜${replyLabel}]`
        : `[${displayName}]`;
      return {
        name: displayName,
        is_user: !assistant,
        is_system: false,
        mes: assistant
          ? [timestampPrefix, replyLabel ? `[${replyLabel}]` : '', content]
            .filter(Boolean).join(' ')
          : `${timestampPrefix}${speakerLabel} ${content}`,
        send_date: message?.createdAt || Date.now(),
        extra: { discord_prompt_history: true },
      };
    })
    .filter(Boolean);

  if (injected.length > 0) {
    injected[0].mes = `[近期脈絡]\n${injected[0].mes}`;
  }

  if (injected.length > 0) {
    chat.splice(chat.length - 1, 0, ...injected);
  }
  const attachmentContext = String(currentImageContext || '').trim();
  const currentReplyLabel = formatDiscordReplyLabel(currentReplyTo);
  currentMessage.mes = [
    currentReplyLabel ? `[本次訊息｜${currentReplyLabel}]` : '[本次訊息]',
    String(originalCurrentText || '').trim(),
    attachmentContext,
  ].filter(Boolean).join('\n\n');

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    currentMessage.mes = originalCurrentText;
    for (const message of injected) {
      const index = chat.indexOf(message);
      if (index >= 0) chat.splice(index, 1);
    }
  };
}

function formatDiscordHistoryTimestamp(value, timeZone, locale) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat(locale || 'zh-TW', {
      timeZone: timeZone || 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
