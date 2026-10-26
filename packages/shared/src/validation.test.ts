import test from 'node:test';
import assert from 'node:assert';
import { normalizeEmail, normalizePhone, USERNAME_RE } from './validation';

test('phone: Pakistani local, spaced, 00 and + forms all normalise', () => {
  for (const v of ['03001234567', '0300 1234567', '+92 300 1234567', '0092-300-1234567', '+923001234567'])
    assert.strictEqual(normalizePhone(v), '+923001234567', v);
});
test('phone: foreign numbers keep their country', () => {
  assert.strictEqual(normalizePhone('+49 151 23456789'), '+4915123456789');
  assert.strictEqual(normalizePhone('+1 415 555 2671'), '+14155552671');
});
test('phone: junk, too short, letters and landline-only are rejected', () => {
  for (const v of ['', '123', 'abc', '+92 42 111 222 333', '++923001234567', '0'.repeat(30), ' ']) assert.strictEqual(normalizePhone(v), null, v);
  assert.strictEqual(normalizePhone(undefined as unknown as string), null);
});
test('email: trims, lowercases, rejects junk', () => {
  assert.strictEqual(normalizeEmail('  Sara@Example.COM '), 'sara@example.com');
  for (const v of ['', 'sara', 'sara@', '@x.com', 'a b@c.com', 'x'.repeat(250) + '@a.co']) assert.strictEqual(normalizeEmail(v), null, v);
});
test('username rules', () => {
  for (const ok of ['sara', 'sara.ahmed', 'sara_92', 'abc']) assert.ok(USERNAME_RE.test(ok), ok);
  for (const bad of ['sa', '.sara', 'sara.', 'sa..ra', 'Sara', 'sara!', 'x'.repeat(31)]) assert.ok(!USERNAME_RE.test(bad), bad);
});
