import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, renderBlocks, plainExcerpt } from '../src/richtext.mjs';
const S = 'philipp-paulik.de';
test('formatting', () => {
  assert.equal(renderBlock('## Titel', S), '<h2>Titel</h2>');
  assert.equal(renderBlock('Ein **fetter** und *kursiver* Text', S), '<p>Ein <strong>fetter</strong> und <em>kursiver</em> Text</p>');
  assert.equal(renderBlock('- a\n- b', S), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderBlock('1. a\n2. b', S), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(renderBlock('> Zitat', S), '<blockquote>Zitat</blockquote>');
});
test('html and unsafe urls are neutralised', () => {
  assert.equal(renderBlock('<script>alert(1)</script>', S), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.ok(!renderBlock('[x](javascript:alert(1))', S).includes('<a'));
  assert.ok(!renderBlock('[x](http://a.de)', S).includes('<a'));
  assert.match(renderBlock('[x](https://a.de/"onmouseover="1)', S), /^<p>/);
  assert.ok(!/onmouseover="/.test(renderBlock('[x](https://a.de/"onmouseover="1)', S)));
  assert.match(renderBlock('[x](https://a.de)', S), /<a href="https:\/\/a.de" rel="noopener noreferrer">x<\/a>/);
});
test('images only from own static host', () => {
  assert.match(renderBlock(`![Alt](https://static.${S}/abc)`, S), /^<figure><img src="https:\/\/static\.philipp-paulik\.de\/abc" alt="Alt"/);
  assert.ok(!renderBlock('![x](https://evil.example/a.png)', S).includes('<img'));
  assert.ok(!renderBlock('![x](https://static.philipp-paulik.de.evil.example/a)', S).includes('<img'));
});
test('excerpt strips markup', () => assert.equal(plainExcerpt('## Hi **du** [x](https://a.de)'), 'Hi du x'));
