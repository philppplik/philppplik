import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/sqlite.mjs';
import { createContentService } from '../src/content.mjs';

function setup(role) {
  const store = new Store();
  const handler = createContentService({ store, site: 'philipp-paulik.de', managementHTML: '<html><head></head><body></body></html>', authenticate: async () => true });
  const req = (path, { method = 'GET', data, r = role } = {}) => handler(new Request(`https://${r}.philipp-paulik.de${path}`, { method, headers: data !== undefined ? { 'content-type': 'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined }), r);
  return { store, req };
}

test('ads host: custom code works like lp and is sandboxed; root opens management', async () => {
  const x = setup('ads');
  assert.match(await (await x.req('/')).text(), /content-role" content="ads"/);
  let r = await x.req('/api/content', { method: 'POST', data: { title: 'Motiv Herbst', custom: { html: '<h1>Ad</h1>', css: '', js: 'var a=1' } } });
  assert.equal(r.status, 201);
  const { slug } = await r.json();
  assert.equal((await x.req('/' + slug)).status, 404);
  await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'published' } });
  const page = await x.req('/' + slug);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /sandbox="allow-scripts/);
});

test('tracking link: UTM short link on l, published only, validated', async () => {
  const x = setup('lp');
  const { slug } = await (await x.req('/api/content', { method: 'POST', data: { title: 'Angebot', paragraphs: ['Text'] } })).json();
  const body = { slug, utm: { source: 'newsletter', medium: 'email', campaign: 'herbst-2026', content: 'cta 1' } };
  assert.equal((await x.req('/api/tracking-link', { method: 'POST', data: body })).status, 409);
  await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'published' } });
  let r = await x.req('/api/tracking-link', { method: 'POST', data: body });
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.match(out.short, /^https:\/\/l\.philipp-paulik\.de\/[a-zA-Z0-9]{6}$/);
  const t = new URL(out.target);
  assert.equal(t.host, 'lp.philipp-paulik.de');
  assert.equal(t.searchParams.get('utm_campaign'), 'herbst-2026');
  assert.equal(t.searchParams.get('utm_content'), 'cta 1');
  const row = await x.store.get('SELECT target FROM links WHERE site=? AND id=?', 'philipp-paulik.de', out.id);
  assert.equal(row.target, out.target);
  for (const bad of [{ slug, utm: { source: 'a' } }, { slug, utm: { source: 'a&b=1', campaign: 'c' } }, { slug, utm: { source: '<x>', campaign: 'c' } }, { slug: 'fehlt', utm: { source: 'a', campaign: 'c' } }]) {
    const s = (await x.req('/api/tracking-link', { method: 'POST', data: bad })).status;
    assert.ok([400, 404].includes(s), JSON.stringify(bad) + s);
  }
});
