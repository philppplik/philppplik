import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Store } from '../src/sqlite.mjs';
import { PostgresStore, schema } from '../src/postgres.mjs';
import { createContentService, contentSchema, slugify, validSlug } from '../src/content.mjs';

function setup(options = {}, role = 'blog') {
  const store = new Store();
  let time = Date.parse('2026-11-16T09:00:00Z');
  const handler = createContentService({ store, site: 'philipp-paulik.de', managementHTML: '<!doctype html><html><head><title>t</title></head><body></body></html>', now: () => time, ...options });
  const req = (path, { method = 'GET', data, r = role } = {}) => {
    const headers = {};
    if (data !== undefined) headers['content-type'] = 'application/json';
    return handler(new Request(`https://${r}.philipp-paulik.de${path}`, { method, headers, body: data !== undefined ? JSON.stringify(data) : undefined }), r);
  };
  return { store, req, advance: n => time += n };
}

test('schema is idempotent; empty public states, no invented content', async () => {
  const x = setup();
  const index = await x.req('/');
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /Noch keine Beiträge veröffentlicht/);
  assert.equal(index.headers.get('x-robots-tag'), null);
  assert.match(index.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await x.req('/')).status, 200);
  assert.equal((await x.req('/fehlt')).status, 404);
  const lpRoot = await x.req('/', { r: 'lp' });
  assert.equal(lpRoot.status, 200);
  assert.match(await lpRoot.text(), /<meta name="content-role" content="lp">/);
  assert.equal((await x.req('/fehlt', { r: 'lp' })).status, 404);
  assert.deepEqual((await (await x.req('/api/content')).json()).items, []);
  x.store.close();
});

test('draft, publish, edit, unpublish, delete lifecycle', async () => {
  const x = setup();
  let r = await x.req('/api/content', { method: 'POST', data: { title: 'Erster Beitrag', paragraphs: ['Zeile eins', 'Zeile zwei'] } });
  assert.equal(r.status, 201);
  const { slug } = await r.json();
  assert.equal(slug, 'erster-beitrag');
  assert.equal((await x.req('/' + slug)).status, 404);
  r = await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'published' } });
  assert.equal(r.status, 200);
  r = await x.req('/' + slug);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<h1>Erster Beitrag<\/h1>/);
  assert.match(html, /Veröffentlicht am 16\. November 2026/);
  assert.match(html, /<p>Zeile eins<\/p><p>Zeile zwei<\/p>/);
  assert.match((await (await x.req('/')).text()), /Erster Beitrag/);
  r = await x.req('/api/content/' + slug, { method: 'POST', data: { title: 'Besserer Titel', paragraphs: ['Neuer Text'] } });
  assert.equal(r.status, 200);
  assert.match(await (await x.req('/' + slug)).text(), /Besserer Titel/);
  r = await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'draft' } });
  assert.equal(r.status, 200);
  assert.equal((await x.req('/' + slug)).status, 404);
  assert.equal((await x.req('/api/content/' + slug, { method: 'DELETE' })).status, 204);
  assert.equal((await x.req('/api/content/' + slug)).status, 404);
  x.store.close();
});

test('no HTML/JS from content: title and paragraphs are escaped', async () => {
  const x = setup();
  const title = '<script>alert(1)</script> & "Anführung"';
  await x.req('/api/content', { method: 'POST', data: { title, paragraphs: ['<img src=x onerror=alert(1)>'] } });
  const slug = slugify(title);
  await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'published' } });
  const html = await (await x.req('/' + slug)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  x.store.close();
});

test('slug rules: reserved, invalid, derived, unique, immutable', async () => {
  assert.equal(validSlug('manage'), null);
  assert.equal(validSlug('api'), null);
  assert.equal(validSlug('Groß'), null);
  assert.equal(validSlug('-ab'), null);
  assert.equal(validSlug('ab-'), null);
  assert.ok(validSlug('ab-cd-2'));
  assert.equal(slugify('Über Größe & Maße!'), 'ueber-groesse-masse');
  const x = setup();
  let r = await x.req('/api/content', { method: 'POST', data: { title: 'T', slug: 'Manage', paragraphs: ['p'] } });
  assert.equal(r.status, 400);
  r = await x.req('/api/content', { method: 'POST', data: { title: 'T', slug: 'manage', paragraphs: ['p'] } });
  assert.equal(r.status, 400);
  r = await x.req('/api/content', { method: 'POST', data: { title: 'T', slug: 'frei', paragraphs: ['p'] } });
  assert.equal(r.status, 201);
  r = await x.req('/api/content', { method: 'POST', data: { title: 'T', slug: 'frei', paragraphs: ['p'] } });
  assert.equal(r.status, 409);
  r = await x.req('/api/content', { method: 'POST', data: { title: 'Doppelt', paragraphs: ['p'] } });
  r = await x.req('/api/content', { method: 'POST', data: { title: 'Doppelt', paragraphs: ['p'] } });
  assert.equal((await r.json()).slug, 'doppelt-2');
  x.store.close();
});

test('validation caps: title, paragraphs, control chars, item cap', async () => {
  const x = setup();
  const post = data => x.req('/api/content', { method: 'POST', data });
  assert.equal((await post({ title: '', paragraphs: ['p'] })).status, 400);
  assert.equal((await post({ title: 'x'.repeat(201), paragraphs: ['p'] })).status, 400);
  assert.equal((await post({ title: 't', paragraphs: [] })).status, 400);
  assert.equal((await post({ title: 't', paragraphs: Array(41).fill('p') })).status, 400);
  assert.equal((await post({ title: 't', paragraphs: ['x'.repeat(4001)] })).status, 400);
  assert.equal((await post({ title: 't', paragraphs: ['ab'] })).status, 400);
  assert.equal((await post({ title: 't', paragraphs: 'kein array' })).status, 400);
  for (let i = 0; i < 100; i++) assert.equal((await post({ title: 't', slug: 's' + i, paragraphs: ['p'] })).status, 201);
  assert.equal((await post({ title: 't', slug: 'eins-zu-viel', paragraphs: ['p'] })).status, 413);
  x.store.close();
});

test('methods, HEAD, rate limit, role guard, authenticate hook', async () => {
  const x = setup({ publicPerMinute: 2 });
  await x.req('/api/content', { method: 'POST', data: { title: 'Post', paragraphs: ['p'] } });
  await x.req('/api/content/post/status', { method: 'POST', data: { status: 'published' } });
  assert.equal((await x.req('/post', { method: 'PUT' })).status, 405);
  assert.equal((await x.req('/post', { method: 'HEAD' })).status, 200);
  assert.equal((await x.req('/post')).status, 200);
  assert.equal((await x.req('/post')).status, 429);
  assert.equal((await x.req('/post', { r: 'admin' })).status, 404);
  assert.equal((await x.req('/api/content', { r: 'admin' })).status, 404);
  x.store.close();
  const y = setup({ authenticate: async req => req.headers.get('x-test-auth') === '1' });
  assert.equal((await y.req('/api/content')).status, 401);
  const ok = await y.req('/api/content');
  assert.equal(ok.status, 401);
  const direct = await createContentService({ store: y.store, site: 'philipp-paulik.de', authenticate: async req => req.headers.get('x-test-auth') === '1' })(new Request('https://blog.philipp-paulik.de/api/content', { headers: { 'x-test-auth': '1' } }), 'blog');
  assert.equal(direct.status, 200);
  y.store.close();
});

test('CTA and hero image: validation, rendering, clearing', async () => {
  const x = setup({}, 'lp');
  const hero = 'https://static.philipp-paulik.de/' + 'a'.repeat(32);
  const bad = [
    { title: 't', paragraphs: ['p'], cta: { label: 'Los', url: 'http://example.com' } },
    { title: 't', paragraphs: ['p'], cta: { label: 'Los', url: 'https://user:pass@example.com' } },
    { title: 't', paragraphs: ['p'], cta: { label: 'Los', url: 'https://127.0.0.1/x' } },
    { title: 't', paragraphs: ['p'], cta: 'kein objekt' },
    { title: 't', paragraphs: ['p'], cta: { label: 'a\n b', url: 'https://example.com' } },
    { title: 't', paragraphs: ['p'], hero_image: 'https://images.example.com/x.png' },
    { title: 't', paragraphs: ['p'], hero_image: 'https://static.philipp-paulik.de/nothex' },
    { title: 't', paragraphs: ['p'], hero_image: hero + '?x=1' },
    { title: 't', paragraphs: ['p'], hero_image: 'https://static.andere-site.de/' + 'a'.repeat(32) },
  ];
  for (const data of bad) assert.equal((await x.req('/api/content', { method: 'POST', data, r: 'lp' })).status, 400, JSON.stringify(data));
  let r = await x.req('/api/content', { method: 'POST', r: 'lp', data: { title: 'Angebot', paragraphs: ['Text'], cta: { label: 'Jetzt <b>ansehen</b>', url: 'https://paulikreisch.de/buch' }, hero_image: hero } });
  assert.equal(r.status, 201);
  const { slug } = await r.json();
  await x.req(`/api/content/${slug}/status`, { method: 'POST', r: 'lp', data: { status: 'published' } });
  r = await x.req('/' + slug, { r: 'lp' });
  const html = await r.text();
  assert.match(html, /href="https:\/\/paulikreisch\.de\/buch"/);
  assert.match(html, /Jetzt &lt;b&gt;ansehen&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>ansehen</b>'));
  assert.match(html, new RegExp(`<img class="heroimg" src="${hero.replaceAll('/', '\\/')}"`));
  assert.match(r.headers.get('content-security-policy'), /img-src https:\/\/static\.philipp-paulik\.de/);
  r = await x.req('/api/content/' + slug, { method: 'POST', r: 'lp', data: { title: 'Angebot', paragraphs: ['Text'], cta: null, hero_image: null } });
  assert.equal(r.status, 200);
  const cleared = await (await x.req('/' + slug, { r: 'lp' })).text();
  assert.ok(!cleared.includes('<img class="heroimg"') && !cleared.includes('class="cta"'));
  x.store.close();
});

test('lp root opens management shell; blog index links manage; preview stays gated', async () => {
  const x = setup();
  const lpRoot = await x.req('/', { r: 'lp' });
  assert.equal(lpRoot.status, 200);
  assert.match(await lpRoot.text(), /<meta name="content-role" content="lp">/);
  const index = await (await x.req('/')).text();
  assert.match(index, /href="\/manage" rel="nofollow">Verwalten</);
  assert.equal((await x.req('/preview/irgendwas')).status, 404);
  x.store.close();
  const denied = setup({ authenticate: async () => false });
  assert.equal((await denied.req('/preview/irgendwas')).status, 401);
  denied.store.close();
  const allowed = setup({ authenticate: async () => true });
  await allowed.req('/api/content', { method: 'POST', data: { title: 'Geheim', slug: 'geheim', paragraphs: ['Noch Entwurf'] } });
  assert.equal((await allowed.req('/geheim')).status, 404);
  const prev = await allowed.req('/preview/geheim');
  assert.equal(prev.status, 200);
  const html = await prev.text();
  assert.match(html, /Entwurfsvorschau/);
  assert.match(html, /Geheim/);
  assert.equal(prev.headers.get('x-robots-tag'), 'noindex, nofollow');
  allowed.store.close();
});

test('management page carries role meta and noindex; assets served', async () => {
  const store = new Store();
  const handler = createContentService({
    store, site: 'philipp-paulik.de', managementHTML: '<!doctype html><html><head><title>t</title></head><body></body></html>',
    managementAssets: { '/content.css': { body: 'body{}', type: 'text/css' }, '/content.js': { body: 'x=1', type: 'text/javascript' } },
  });
  let r = await handler(new Request('https://lp.philipp-paulik.de/manage'), 'lp');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<meta name="content-role" content="lp">/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  r = await handler(new Request('https://lp.philipp-paulik.de/content.css'), 'lp');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/css');
  store.close();
});

test('PostgreSQL dialect: schema, lifecycle and counters via PostgresStore', async () => {
  const pg = new PGlite();
  await pg.exec('CREATE FUNCTION pg_advisory_xact_lock(integer) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
  await pg.exec(schema + contentSchema);
  const pool = { query: (text, args) => pg.query(text, args), connect: async () => ({ query: (text, args) => pg.query(text, args), release() {} }) };
  const store = new PostgresStore(pool);
  const handler = createContentService({ store, site: 'philipp-paulik.de' });
  const req = (path, { method = 'GET', data, role = 'blog' } = {}) => {
    const headers = {};
    if (data !== undefined) headers['content-type'] = 'application/json';
    return handler(new Request(`https://${role}.philipp-paulik.de${path}`, { method, headers, body: data !== undefined ? JSON.stringify(data) : undefined }), role);
  };
  let r = await req('/api/content', { method: 'POST', role: 'lp', data: { title: 'PG Seite', paragraphs: ['Absatz'], cta: { label: 'Mehr', url: 'https://example.com' }, hero_image: 'https://static.philipp-paulik.de/' + 'b'.repeat(32) } });
  assert.equal(r.status, 201);
  const { slug } = await r.json();
  await req(`/api/content/${slug}/status`, { method: 'POST', role: 'lp', data: { status: 'published' } });
  r = await req('/' + slug, { role: 'lp' });
  assert.equal(r.status, 200);
  const pgHtml = await r.text();
  assert.match(pgHtml, /PG Seite/);
  assert.match(pgHtml, /class="cta"/);
  assert.match(pgHtml, /class="heroimg"/);
  const list = await (await req('/api/content', { role: 'lp' })).json();
  assert.equal(list.items.length, 1);
  assert.equal(typeof list.items[0].published_at, 'number');
  assert.equal((await req('/api/content/' + slug, { method: 'DELETE', role: 'lp' })).status, 204);
  await pg.close();
});
