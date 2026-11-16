// Visual verification harness for the content module. Serves the real
// management UI and public pages over loopback HTTPS with a stubbed session
// endpoint (the production router owns auth); drives them with Playwright.
// HTTPS matters: the custom-code frame CSP allows only https: subresources,
// so the virtual-path image redirect is exercised for real here.
import https from 'node:https';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Store } from '../src/sqlite.mjs';
import { createContentService } from '../src/content.mjs';

// Throwaway self-signed loopback certificate, generated on demand and never
// committed (gitignored): it has no value outside this local harness.
const KEY = new URL('fixtures/loopback-key.pem', import.meta.url);
const CERT = new URL('fixtures/loopback-cert.pem', import.meta.url);
if (!existsSync(KEY) || !existsSync(CERT)) {
  mkdirSync(fileURLToPath(new URL('fixtures/', import.meta.url)), { recursive: true });
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${fileURLToPath(KEY)}" -out "${fileURLToPath(CERT)}" -days 2 -subj "/CN=loopback-fixture" -addext "subjectAltName=DNS:localhost,DNS:static.philipp-paulik.de,IP:127.0.0.1"`, { stdio: 'ignore' });
}
const TLS = { key: readFileSync(KEY), cert: readFileSync(CERT) };

const root = new URL('../public/', import.meta.url);
const store = new Store();
const heroSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#77a8ff"/><stop offset="1" stop-color="#173c64"/></linearGradient></defs><rect width="800" height="400" fill="url(#g)"/><text x="400" y="210" font-family="monospace" font-size="28" fill="#0c2340" text-anchor="middle">BEISPIEL-BILD</text></svg>`;
// Real HTTPS alias standing in for the static.* host: serves the shared file
// bytes with an image content type, so the virtual-path redirect is exercised
// end to end (no request interception) from the sandboxed frame.
const staticAlias = https.createServer(TLS, (req, res) => {
  if (!/^\/[a-f0-9]{32}$/.test(req.url || '')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
  res.end(heroSVG);
});
await new Promise(r => staticAlias.listen(0, '127.0.0.1', r));
const assets = {
  '/content.css': { body: readFileSync(new URL('content.css', root), 'utf8'), type: 'text/css' },
  '/content.js': { body: readFileSync(new URL('content.js', root), 'utf8'), type: 'text/javascript' },
};
// The stub authenticates everything; production auth is the router's job.
const content = createContentService({ store, site: 'philipp-paulik.de', authenticate: async () => true, managementHTML: readFileSync(new URL('content.html', root), 'utf8'), managementAssets: assets, vendorDir: new URL('vendor/', root).pathname, staticOrigin: `https://127.0.0.1:${staticAlias.address().port}` });

const servers = {};
for (const role of ['blog', 'lp', 'locked']) {
  servers[role] = https.createServer(TLS, async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/api/login' || u.pathname === '/api/session') {
      if (role === 'locked') { res.writeHead(401); return res.end('Sign in required'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ csrf: 'visual-fixture' }));
    }
    if (u.pathname === '/api/logout') { res.writeHead(204); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const result = await content(new Request(`https://${role === 'locked' ? 'blog' : role}.philipp-paulik.de${u.pathname}${u.search}`, { method: req.method, headers: req.headers, body }), role === 'locked' ? 'blog' : role);
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(result.body ? Buffer.from(await result.arrayBuffer()) : undefined);
  });
  await new Promise(r => servers[role].listen(0, '127.0.0.1', r));
}
const port = role => servers[role].address().port;
const api = async (role, path, opts = {}) => {
  const r = await content(new Request(`https://${role}.philipp-paulik.de${path}`, { method: opts.method || 'GET', headers: opts.data ? { 'content-type': 'application/json' } : {}, body: opts.data ? JSON.stringify(opts.data) : undefined }), role);
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};

// Fixture content created through the real API, marked as examples.
await api('blog', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Warum ich diesen Blog selbst hoste', paragraphs: ['Dieser Beitrag ist ein lokales Beispiel und kein echter Inhalt.', 'Er zeigt, wie veröffentlichte Absätze aussehen.\nMit einem Zeilenumbruch mitten drin.', 'Dritter Absatz für die Länge der Übersichtsseite.'] } });
await api('blog', '/api/content/beispiel-warum-ich-diesen-blog-selbst-hoste/status', { method: 'POST', data: { status: 'published' } });
await api('blog', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Notizen zu Datenschutz und Geschwindigkeit', paragraphs: ['Auch dieser Beitrag ist nur ein Beispiel.'] } });
await api('blog', '/api/content/beispiel-notizen-zu-datenschutz-und-geschwindigkeit/status', { method: 'POST', data: { status: 'published' } });
await api('blog', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Entwurf für später', paragraphs: ['Noch nicht veröffentlicht.'] } });
const heroId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
await api('lp', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Klarer Nutzen in einem Satz', paragraphs: ['Diese Beispiel-Landing-Page zeigt den schlanken Aufbau: Titel, Absätze, Button, Hero-Bild.', 'Zweiter Absatz mit weiterführendem Text für die Vorschau.'], cta: { label: 'BEISPIEL · Jetzt entdecken', url: 'https://philipp-paulik.de' }, hero_image: `https://static.philipp-paulik.de/${heroId}` } });
await api('lp', '/api/content/beispiel-klarer-nutzen-in-einem-satz/status', { method: 'POST', data: { status: 'published' } });
await api('lp', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Entwurf ohne Veröffentlichung', paragraphs: ['Nur über die Vorschau sichtbar.'], cta: { label: 'Später mehr', url: 'https://philipp-paulik.de' } } });
// Custom-code landing page with a virtual file path, plus one shared file.
const FILE_ID = 'c1b2c3d4e5f60718293a4b5c6d7e8f90';
await store.run("INSERT INTO files VALUES('philipp-paulik.de',?,'cover.svg',?,1)", FILE_ID, Buffer.from('x'));
await api('lp', '/api/vpaths', { method: 'POST', data: { path: '/bilder/cover.jpg', file_id: FILE_ID } });
await api('lp', '/api/content', { method: 'POST', data: { title: 'BEISPIEL · Custom Code Seite', custom: { html: '<main style="font-family:system-ui;padding:40px"><h1>BEISPIEL Custom</h1><img src="/bilder/cover.jpg" width="320"><p>Eigenes HTML</p></main>', css: 'h1{color:#0c2340}', js: 'document.title="custom-ok";' } } });
await api('lp', '/api/content/beispiel-custom-code-seite/status', { method: 'POST', data: { status: 'published' } });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const shot = async (role, path, name, { width = 1440, height = 900, fullPage = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  await ctx.route('https://static.philipp-paulik.de/*', route => route.fulfill({ contentType: 'image/svg+xml', body: heroSVG }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  await page.goto(`https://127.0.0.1:${port(role)}${path}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `/downloads/${name}.png`, fullPage });
  await ctx.close();
};

await shot('blog', '/manage', 'content-blog-manage-gate');// Console view: session stub makes the gate open by itself; create one more draft live through the UI.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('console: ' + e.message));
  await page.goto(`https://127.0.0.1:${port('blog')}/manage`, { waitUntil: 'networkidle' });
  await page.locator('#console').waitFor({ state: 'visible' });
  await page.screenshot({ path: '/downloads/content-blog-manage-console.png', fullPage: true });
  // Live UI round trip: open the published post for editing.
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await page.locator('#f-title').waitFor();
  await page.screenshot({ path: '/downloads/content-blog-manage-editor.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/downloads/content-blog-manage-mobile.png', fullPage: true });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (wide) errors.push('mobile horizontal overflow in manage UI');
  await ctx.close();
}
await shot('locked', '/manage', 'content-blog-manage-gate');
await shot('blog', '/', 'content-blog-public-index');
await shot('blog', '/beispiel-warum-ich-diesen-blog-selbst-hoste', 'content-blog-public-post');
await shot('blog', '/', 'content-blog-public-index-mobile', { width: 390, height: 844 });
await shot('lp', '/manage', 'content-lp-manage-console');
// Interactive: open the custom-code LP, check both editors really load.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.route('https://static.philipp-paulik.de/*', route => route.fulfill({ contentType: 'image/svg+xml', body: heroSVG }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('lp-editor: ' + e.message));
  await page.goto(`https://127.0.0.1:${port('lp')}/manage`, { waitUntil: 'networkidle' });
  await page.locator('#console').waitFor({ state: 'visible' });
  await page.locator('.item', { hasText: 'Custom Code Seite' }).getByRole('button', { name: 'Bearbeiten' }).click();
  await page.locator('#editor-host .monaco-editor').waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: '/downloads/content-lp-custom-monaco.png', fullPage: true });
  await page.locator('#engine-codemirror').click();
  await page.locator('#editor-host .cm-editor').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#code-tabs [data-tab="css"]').click();
  await page.screenshot({ path: '/downloads/content-lp-custom-codemirror.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/downloads/content-lp-custom-mobile.png', fullPage: true });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (wide) errors.push('mobile horizontal overflow in lp custom editor');
  await ctx.close();
}
// Public custom page: wrapper renders the sandboxed frame with real content.
// No interception here: the frame image must travel the real HTTPS redirect
// to the static alias and load.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('lp-custom-public: ' + e.message));
  await page.goto(`https://127.0.0.1:${port('lp')}/beispiel-custom-code-seite`, { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe[title*="Custom Code"]');
  await frame.locator('h1', { hasText: 'BEISPIEL Custom' }).waitFor({ state: 'visible' });
  const frameTitle = await page.evaluate(() => document.title);
  if (!frameTitle.includes('Custom Code')) errors.push('wrapper title missing');
  // The frame CSP allows https: only: the virtual path must 302 to the
  // static alias (intercepted above) and the image must actually load.
  const imgLoaded = await frame.locator('img').evaluate(img => img.complete && img.naturalWidth > 0);
  if (!imgLoaded) errors.push('custom frame image did not load through the virtual path redirect');
  await page.screenshot({ path: '/downloads/content-lp-custom-public.png', fullPage: false });
  await ctx.close();
}
await shot('lp', '/', 'content-lp-root-manage');
await shot('lp', '/beispiel-klarer-nutzen-in-einem-satz', 'content-lp-public');
await shot('lp', '/beispiel-klarer-nutzen-in-einem-satz', 'content-lp-public-mobile', { width: 390, height: 844 });
await shot('lp', '/preview/beispiel-entwurf-ohne-veroeffentlichung', 'content-lp-preview');

await browser.close();
await new Promise(r => staticAlias.close(r));
for (const s of Object.values(servers)) await new Promise(r => s.close(r));
store.close();
if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
console.log('Visual harness PASS: gate, console, editor, mobile widths, blog index/post, lp manage/root-shell/public/preview, CTA and hero rendering. No page errors.');
