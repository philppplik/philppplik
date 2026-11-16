import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the same static source copy and generator used by Pages.
test('public build omits the retired project in both languages and metadata', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-public-'));
  try {
    fs.cpSync(new URL('../public/', import.meta.url), out, { recursive: true });
    execFileSync(process.execPath, ['site/src/build.mjs', out]);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const file = path.join(dir, e.name);
      return e.isDirectory() ? walk(file) : [file];
    });
    assert.equal(fs.existsSync(path.join(out, 'somnia')), false);
    for (const file of walk(out)) {
      assert.doesNotMatch(path.relative(out, file), /somnia/i);
      if (/\.(html|css|js|json|xml|txt|svg)$/.test(file)) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /somnia|hallo.welt|paulikreisch|paulik\s*(&|&amp;)\s*reisch/i, file);
      }
    }
    const content = JSON.parse(fs.readFileSync(new URL('../src/content.json', import.meta.url)));
    for (const route of ['index.html', 'en/index.html']) {
      const html = fs.readFileSync(path.join(out, route), 'utf8');
      assert.doesNotMatch(html, /hallo.welt|paulikreisch|Paulik & Reisch/i);
      assert.match(html, /id="h-faq"/);
      assert.match(html, /id="kontakt"/);
      assert.match(html, /application\/ld\+json/);
      for (const project of content.projects) assert.ok(html.includes(project.url), project.name);
    }
    assert.ok(fs.existsSync(path.join(out, '404.html')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
