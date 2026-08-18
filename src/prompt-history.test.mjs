import test from 'node:test';
import assert from 'node:assert/strict';
import {
  injectDiscordPromptHistory,
  suppressPreviousChatMessages,
} from './prompt-history.mjs';

test('suppresses persisted messages except the current user message', () => {
  const ignore = Symbol.for('ignore-test');
  const chat = [
    { is_user: false, mes: 'opening', extra: {} },
    { is_user: true, mes: 'old question' },
    { is_user: false, mes: 'old answer', extra: {} },
    { is_user: true, mes: 'current question', extra: {} },
  ];
  const restore = suppressPreviousChatMessages(chat, ignore);
  assert.equal(chat[0].extra[ignore], true);
  assert.equal(chat[1].extra[ignore], true);
  assert.equal(chat[2].extra[ignore], true);
  assert.equal(chat[3].extra[ignore], undefined);
  restore();
  assert.equal(chat[0].extra[ignore], undefined);
  assert.equal(chat[1].extra, undefined);
  assert.equal(chat[2].extra[ignore], undefined);
});

test('preserves messages that were already manually hidden', () => {
  const ignore = Symbol.for('ignore-test-existing');
  const chat = [
    { is_user: false, extra: { [ignore]: true } },
    { is_user: true, extra: {} },
  ];
  const restore = suppressPreviousChatMessages(chat, ignore);
  restore();
  assert.equal(chat[0].extra[ignore], true);
});

test('does nothing unless the newest message is a user message', () => {
  const ignore = Symbol.for('ignore-test-invalid');
  const chat = [{ is_user: false, extra: {} }];
  suppressPreviousChatMessages(chat, ignore)();
  assert.equal(chat[0].extra[ignore], undefined);
});

test('injects Discord history as user and assistant turns then restores chat', () => {
  const chat = [{ is_user: true, mes: '小黑 早上好' }];
  const current = chat[0];
  const restore = injectDiscordPromptHistory(chat, [
    { id: '1', displayName: 'TestUserA', content: '小黑在不在', assistant: false },
    { id: '2', displayName: 'Kuro', content: '……嗯。我在。', assistant: true },
  ], '[本次附件觀察]\n圖片摘要：一隻黑貓');

  assert.equal(chat.length, 3);
  assert.equal(chat[0].is_user, true);
  assert.equal(chat[0].mes, '[近期脈絡]\n[TestUserA] 小黑在不在');
  assert.equal(chat[1].is_user, false);
  assert.equal(chat[1].mes, '……嗯。我在。');
  assert.match(chat[2].mes, /^\[本次訊息\]/);
  assert.match(chat[2].mes, /圖片摘要：一隻黑貓/);

  restore();
  assert.deepEqual(chat, [current]);
  assert.equal(current.mes, '小黑 早上好');
});

test('renders Discord history timestamps in the configured timezone', () => {
  const chat = [{ is_user: true, mes: 'current question' }];
  const restore = injectDiscordPromptHistory(
    chat,
    [
      {
        id: '1',
        displayName: 'Alice',
        content: 'older question',
        assistant: false,
        createdAt: '2026-08-05T15:03:14.431Z',
      },
      {
        id: '2',
        displayName: 'Kuro',
        content: 'older answer',
        assistant: true,
        createdAt: '2026-08-05T15:03:18.623Z',
      },
    ],
    '',
    { timeZone: 'Asia/Taipei', locale: 'zh-TW' },
  );

  assert.equal(
    chat[0].mes,
    '[近期脈絡]\n[2026-08-05 23:03][Alice] older question',
  );
  assert.equal(chat[1].mes, '[2026-08-05 23:03] older answer');
  restore();
});

test('removes stage directions from assistant history without changing user messages', () => {
  const chat = [{ is_user: true, mes: 'current question' }];
  const restore = injectDiscordPromptHistory(chat, [
    {
      id: '1',
      displayName: 'Alice',
      content: '（小聲）這是使用者原本輸入的括號。',
      assistant: false,
    },
    {
      id: '2',
      displayName: 'Kuro',
      content: '（耳朵輕輕抖了一下）\n……嗯。我在。\n*尾巴晃了晃*',
      assistant: true,
    },
  ]);

  assert.match(chat[0].mes, /（小聲）/);
  assert.equal(chat[1].mes, '……嗯。我在。');
  restore();
});

test('renders recent and current Discord reply relationships without leaking Kuro stage directions', () => {
  const chat = [{ is_user: true, mes: '現在早上了啦' }];
  const restore = injectDiscordPromptHistory(chat, [
    {
      displayName: '肉圓',
      content: '你怎麼還沒睡',
      assistant: false,
      replyTo: {
        displayName: 'Kuro',
        content: '（耳朵抖了一下）\n……夜貓子。',
        assistant: true,
      },
    },
    {
      displayName: 'Kuro',
      content: '……因為，我還醒著。',
      assistant: true,
      replyTo: { unavailable: true },
    },
  ], '', {
    currentReplyTo: {
      displayName: 'Kuro',
      content: '*尾巴晃了晃*\n……嗯，我在。',
      assistant: true,
    },
  });

  assert.equal(
    chat[0].mes,
    '[近期脈絡]\n[肉圓｜回覆 Kuro 的「……夜貓子。」] 你怎麼還沒睡',
  );
  assert.equal(chat[1].mes, '[回覆一則已無法取得的訊息] ……因為，我還醒著。');
  assert.equal(
    chat[2].mes,
    '[本次訊息｜回覆 Kuro 的「……嗯，我在。」]\n\n現在早上了啦',
  );
  restore();
});
