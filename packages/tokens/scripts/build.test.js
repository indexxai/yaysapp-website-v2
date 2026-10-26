const test = require('node:test');
const assert = require('node:assert');
const t = require('../dist/index.js');
test('brand green is the lime the client picked', () => {
  assert.strictEqual(t.color.light.success.toLowerCase(), '#88f102');
  assert.strictEqual(t.color.dark.success.toLowerCase(), '#88f102');
  assert.strictEqual(t.color.light['success-hover'].toLowerCase(), '#7fcc1b');
});
test('references resolve to real colours in both themes', () => {
  for (const theme of ['light', 'dark']) for (const [k, v] of Object.entries(t.color[theme])) assert.ok(!/^\{/.test(v), `${theme}.${k} unresolved`);
});
test('spacing is numeric for React Native', () => { assert.strictEqual(t.space['space-4'], 16); });
