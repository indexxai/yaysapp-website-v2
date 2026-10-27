import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageTextSchema, sendMessageSchema, textLength, tickFor } from './chat';
import { mergeMessages, uuid } from './engine';
import { dayLabel, lastSeen, listTime } from './format';

const conv = (receipts: Record<string, { deliveredSeq: number; readSeq: number }>) => ({ memberIds: ['me', 'a', 'b'], receipts });

test('ticks: read only when every other member read; delivered when every device has it', () => {
  const m = { seq: 5, senderId: 'me' };
  assert.equal(tickFor(m, conv({ a: { deliveredSeq: 4, readSeq: 0 }, b: { deliveredSeq: 9, readSeq: 9 } })), 'sent');
  assert.equal(tickFor(m, conv({ a: { deliveredSeq: 5, readSeq: 0 }, b: { deliveredSeq: 9, readSeq: 9 } })), 'delivered');
  assert.equal(tickFor(m, conv({ a: { deliveredSeq: 5, readSeq: 5 }, b: { deliveredSeq: 9, readSeq: 9 } })), 'read');
  assert.equal(tickFor(m, conv({ a: { deliveredSeq: 0, readSeq: 7 } })), 'sent'); // b has no receipt yet
  assert.equal(tickFor(m, { memberIds: ['me'], receipts: {} }), 'sent');
});

test('message text: trimmed, never empty, 4096 characters as people count them', () => {
  assert.equal(messageTextSchema.parse('  hi  '), 'hi');
  assert.equal(messageTextSchema.safeParse(' \n\t ').success, false);
  assert.equal(messageTextSchema.safeParse('\u0000').success, false);
  assert.equal(textLength('😀😀'), 2);
  assert.equal(messageTextSchema.safeParse('😀'.repeat(4096)).success, true);
  assert.equal(messageTextSchema.safeParse('a'.repeat(4097)).success, false);
  assert.equal(sendMessageSchema.safeParse({ clientId: 'not-a-uuid', text: 'x' }).success, false);
  const id = uuid().toUpperCase();
  assert.equal(sendMessageSchema.parse({ clientId: id, text: 'x' }).clientId, id.toLowerCase());
});

test('uuid works without crypto.randomUUID (React Native)', () => {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const ids = new Set([...Array(500)].map(() => uuid()));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true }); }
});

test('merging message lists keeps order by number and drops repeats', () => {
  const m = (seq: number, text = `m${seq}`) => ({ id: String(seq), conversationId: 'c', seq, senderId: 'a', clientId: String(seq), type: 'text' as const, text, createdAt: '' });
  assert.deepEqual(mergeMessages([m(1), m(3)], [m(2), m(3, 'again'), m(4)]).map((x) => [x.seq, x.text]), [[1, 'm1'], [2, 'm2'], [3, 'again'], [4, 'm4']]);
  const a = [m(1)];
  assert.equal(mergeMessages(a, []), a);
});

test('dates read the way people say them', () => {
  const now = new Date();
  const at = (daysBack: number, h = 9, min = 5) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, h, min).toISOString();
  assert.equal(listTime(at(0)), '09:05');
  assert.equal(listTime(at(1)), 'Yesterday');
  assert.match(listTime(at(3)), /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/);
  assert.match(listTime(at(40)), /^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/);
  assert.equal(dayLabel(at(0)), 'Today');
  assert.equal(lastSeen(at(0, 14, 30)), 'last seen today at 14:30');
  assert.equal(lastSeen(at(1, 8, 0)), 'last seen yesterday at 08:00');
});
