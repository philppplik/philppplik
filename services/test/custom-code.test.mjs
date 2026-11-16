import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/sqlite.mjs';
import { createContentService } from '../src/content.mjs';

function setup(options = {}, role = 'lp') {
  const store = new Store();
  let time = Date.parse('2026-11-16T09:00:00Z');
  const handler = createContentService({ store, site: 'philipp-paulik.de', managementHTML: '<!doctype html><html><head><title>t</title></head><body></body></html>', now: () => time, ...options });
  const req = (path, { method = 'GET', data, r = role, headers = {} } = {}) => {
    const h = { ...headers };
    if (data !== undefined) h['content-type'] = 'application/json';
    return handler(new Request(`https://${r}.philipp-paulik.de${path}`, { method, headers: h, body: data !== undefined ? JSON.stringify(data) : undefined }), r);
  };
  return { store, req };
}
const FILE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CUSTOM = { html: '<h1>Angebot</h1><img src="/bilder/cover.jpg">', css: 'h1{color:red}', js: 'console.log(1)' };

test('custom landing page: CRUD, wrapper, sandboxed frame, guards', async () => {
  const x = setup({ authenticate: async () => true });
  let r = await x.req('/api/content', { method: 'POST', data: { title: 'Custom Seite', custom: CUSTOM } });
  assert.equal(r.status, 201);
  const { slug } = await r.json();
  // Paragraphs optional in custom mode
  const item = await (await x.req('/api/content/' + slug)).json();
  assert.equal(item.custom_html, CUSTOM.html);
  assert.deepEqual(item.paragraphs, []);
  // Draft: nothing public
  assert.equal((await x.req('/' + slug)).status, 404);
  assert.equal((await x.req('/frame/' + slug, { headers: { 'sec-fetch-dest': 'iframe' } })).status, 404);
  // Authenticated preview of the draft: wrapper + preview frame
  const prev = await x.req('/preview/' + slug);
  assert.equal(prev.status, 200);
  const prevHtml = await prev.text();
  assert.match(prevHtml, /sandbox="allow-scripts allow-forms allow-popups allow-top-navigation"/);
  assert.match(prevHtml, /src="\/preview-frame\//);
  assert.match(prevHtml, /noindex/);
  assert.match(prev.headers.get('content-security-policy'), /frame-src 'self'/);
  const pf = await x.req('/preview-frame/' + slug, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(pf.status, 200);
  const doc = await pf.text();
  assert.match(doc, /<h1>Angebot<\/h1>/);
  assert.match(doc, /<style>\nh1\{color:red\}\n<\/style><\/head>/);
  assert.match(doc, /<script>\nconsole\.log\(1\)\n<\/script><\/body>/);
  // Publish: wrapper on the slug, custom doc on /frame
  await x.req(`/api/content/${slug}/status`, { method: 'POST', data: { status: 'published' } });
  const pub = await x.req('/' + slug);
  assert.equal(pub.status, 200);
  const pubHtml = await pub.text();
  assert.match(pubHtml, /src="\/frame\//);
  assert.match(pub.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(pub.headers.get('content-security-policy'), /frame-src 'self'/);
  // Frame only for real iframe loads when the browser reports a destination
  // (legacy browsers without Sec-Fetch-Dest are served for compatibility)
  assert.equal((await x.req('/frame/' + slug)).status, 200);
  assert.equal((await x.req('/frame/' + slug, { headers: { 'sec-fetch-dest': 'document' } })).status, 404);
  const fr = await x.req('/frame/' + slug, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(fr.status, 200);
  assert.match(fr.headers.get('content-security-policy'), /unsafe-inline/);
  assert.match(fr.headers.get('x-robots-tag'), /noindex/);
  // Full documents are served as-is (with CSS/JS injection points respected)
  await x.req('/api/content/' + slug, { method: 'POST', data: { title: 'Custom Seite', custom: { html: '<!doctype html><html><head><title>Eigen</title></head><body><p>voll</p></body></html>', css: 'p{margin:0}', js: '' } } });
  const full = await (await x.req('/frame/' + slug, { headers: { 'sec-fetch-dest': 'iframe' } })).text();
  assert.match(full, /^<!doctype html><html>/);
  assert.match(full, /<style>\np\{margin:0\}\n<\/style><\/head>/);
  assert.ok(!full.includes('<script>'));
  // Clearing custom returns the page to structured mode (paragraphs required again)
  r = await x.req('/api/content/' + slug, { method: 'POST', data: { title: 'Custom Seite', custom: null } });
  assert.equal(r.status, 400);
  r = await x.req('/api/content/' + slug, { method: 'POST', data: { title: 'Custom Seite', paragraphs: ['Text'], custom: null } });
  assert.equal(r.status, 200);
  const structured = await (await x.req('/' + slug)).text();
  assert.match(structured, /<h1>Custom Seite<\/h1>/);
  assert.equal((await x.req('/frame/' + slug, { headers: { 'sec-fetch-dest': 'iframe' } })).status, 404);
  x.store.close();
});

test('custom code validation and blog rejection', async () => {
  const x = setup();
  // CSS/JS without HTML rejected
  assert.equal((await x.req('/api/content', { method: 'POST', data: { title: 'X', custom: { css: 'a{}' } } })).status, 400);
  // Blog role rejects custom code outright
  assert.equal((await x.req('/api/content', { method: 'POST', data: { title: 'X', paragraphs: ['t'], custom: CUSTOM }, r: 'blog' })).status, 400);
  // Size caps
  assert.equal((await x.req('/api/content', { method: 'POST', data: { title: 'X', custom: { html: 'x'.repeat(100001) } } })).status, 400);
  // List exposes has_custom
  await x.req('/api/content', { method: 'POST', data: { title: 'Custom', custom: CUSTOM } });
  await x.req('/api/content', { method: 'POST', data: { title: 'Strukturiert', paragraphs: ['Text'] } });
  const { items } = await (await x.req('/api/content')).json();
  assert.equal(items.find(i => i.title === 'Custom').has_custom, true);
  assert.equal(items.find(i => i.title === 'Strukturiert').has_custom, false);
  x.store.close();
});

test('virtual paths: create, redirect, share gating, validation, delete', async () => {
  const x = setup();
  // Seed a private and a shared file directly
  await x.store.run("INSERT INTO files VALUES('philipp-paulik.de',?,'cover.jpg',?,0)", FILE_ID, Buffer.from('img'));
  await x.store.run("INSERT INTO files VALUES('philipp-paulik.de',?,'logo.png',?,1)", 'b1b2c3d4e5f60718293a4b5c6d7e8f90', Buffer.from('img2'));
  // Validation
  for (const bad of ['bilder/cover.jpg', '/a..b/x.png', '/manage/x.png', '/api/x.png', '/vendor/x.png', '/preview/a.png', '/angebot', '/content.css', '/', '/bilder/', '/BILDER x.png']) {
    const r = await x.req('/api/vpaths', { method: 'POST', data: { path: bad, file_id: FILE_ID } });
    assert.equal(r.status, 400, bad);
  }
  // Unknown file
  assert.equal((await x.req('/api/vpaths', { method: 'POST', data: { path: '/bilder/cover.jpg', file_id: 'ccccccd4e5f60718293a4b5c6d7e8f90' } })).status, 400);
  // Create against the private file: mapping exists but answers 404 until shared
  let r = await x.req('/api/vpaths', { method: 'POST', data: { path: '/BILDER/cover.JPG', file_id: FILE_ID } });
  assert.equal(r.status, 201);
  assert.equal((await x.req('/api/vpaths', { method: 'POST', data: { path: '/bilder/cover.jpg', file_id: FILE_ID } })).status, 409);
  assert.equal((await x.req('/bilder/cover.jpg')).status, 404);
  // Shared file answers with a redirect to the static host
  r = await x.req('/api/vpaths', { method: 'POST', data: { path: '/logo.png', file_id: 'b1b2c3d4e5f60718293a4b5c6d7e8f90' } });
  assert.equal(r.status, 201);
  const red = await x.req('/logo.png');
  assert.equal(red.status, 302);
  assert.equal(red.headers.get('location'), 'https://static.philipp-paulik.de/b1b2c3d4e5f60718293a4b5c6d7e8f90');
  // Sharing the first file flips its path to a redirect
  await x.store.run("UPDATE files SET shared=1 WHERE site='philipp-paulik.de' AND id=?", FILE_ID);
  assert.equal((await x.req('/bilder/cover.jpg')).status, 302);
  // Assets API lists files and mappings; blog host does not offer it
  const assets = await (await x.req('/api/assets')).json();
  assert.equal(assets.files.length, 2);
  assert.equal(assets.vpaths.length, 2);
  assert.equal(assets.vpaths.find(p => p.path === '/bilder/cover.jpg').shared, true);
  assert.equal((await x.req('/api/assets', { r: 'blog' })).status, 200); // blog: image picker
  assert.equal((await x.req('/api/assets', { r: 'static' })).status, 404);
  // Landing-page slugs keep working alongside
  await x.req('/api/content', { method: 'POST', data: { title: 'Normal', paragraphs: ['Text'] } });
  await x.req('/api/content/normal/status', { method: 'POST', data: { status: 'published' } });
  assert.equal((await x.req('/normal')).status, 200);
  // Delete mapping; file itself is untouched
  assert.equal((await x.req('/api/vpaths', { method: 'DELETE', data: { path: '/bilder/cover.jpg' } })).status, 204);
  assert.equal((await x.req('/bilder/cover.jpg')).status, 404);
  assert.equal((await x.req('/api/vpaths', { method: 'DELETE', data: { path: '/bilder/cover.jpg' } })).status, 404);
  x.store.close();
});
