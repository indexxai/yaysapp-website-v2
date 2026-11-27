import test from 'node:test';
import assert from 'node:assert';
import { mdToHtml } from './markdown';

test('mdToHtml keeps spaced-out numbered points in one list (1, 2, 3, not 1, 1, 1)', () => {
  assert.strictEqual(mdToHtml('Ideas:\n\n1. a\n\n2. b\n\n3. c\n\nEnd'), '<p>Ideas:</p>\n<ol><li>a</li><li>b</li><li>c</li></ol>\n<p>End</p>');
});
test('mdToHtml: a list that starts at 4 says so', () => {
  assert.ok(mdToHtml('4. four\n5. five').includes('<ol start="4">'));
});
