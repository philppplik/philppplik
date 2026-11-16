// Structured blog and landing-page content service. Blog posts and the
// default landing-page mode are plain text: no HTML/JS is accepted or
// rendered from them, every public page escapes text and ships a restrictive
// CSP. Landing pages additionally support an opt-in custom-code mode
// (HTML/CSS/JS by the authenticated owner, requested 2026-11-16): custom
// pages are served only inside a sandboxed iframe wrapper (no same-origin),
// so custom JS never shares an origin with the privileged manager session.
// Virtual file paths map pretty paths to shared files on the tenant's own
// static.* host. Local module - no provider, DNS, Git or deployment side
// effects beyond reading vendored editor assets from disk.
//
// Integration contract (see docs/CONTENT.md):
//   const handler = createContentService({store, site, managementHTML, managementAssets});
//   // central router resolves role 'blog' | 'lp' from the exact verified hostname
//   const res = await handler(req, role);
// Public GET routes (blog: '/' and '/<slug>', lp: '/<slug>') are safe to call
// BEFORE authentication. Every '/api/content/*' call MUST be reached only after
// the router's session check, and mutations additionally after its same-origin
// and CSRF checks (identical to '/api/*' in src/service.mjs). Alternatively pass
// an `authenticate(req)` option and this module enforces it itself.

import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_ITEMS = 100;
const MAX_TITLE = 200;
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH = 4000;
const MAX_HTML = 100_000;
const MAX_CSS = 50_000;
const MAX_JS = 100_000;
const MAX_BODY = 400_000;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED = new Set(['manage', 'api', 'content', 'preview', 'frame', 'preview-frame', 'vendor', 'assets']);
// Virtual file paths: lowercase file-like paths, never a bare slug, never a
// reserved first segment. Served by the lp host as a 302 to the static.* file.
const VPATH = /^\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9.])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9.])?)*$/;
const VPATH_BLOCKED = new Set(['api', 'manage', 'preview', 'preview-frame', 'frame', 'vendor', 'content', 'assets', 'content.css', 'content.js']);
const VENDOR_MIME = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json' };
const NOINDEX = {
  'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
};
// Management shell: same-origin scripts only (vendored Monaco/CodeMirror),
// inline styles for the editors' injected <style> tags, same-origin workers
// and fonts, same-origin frames for the sandboxed preview.
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
// Sandboxed custom-code wrapper: only embeds the frame route.
const WRAPPER_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'";
// Inside the sandboxed frame the owner's custom code may load HTTPS
// resources; the opaque origin (no allow-same-origin) is what isolates the
// manager session, so scripts cannot make credentialed same-origin API calls.
const FRAME_CSP = "default-src https: data: blob: 'unsafe-inline' 'unsafe-eval'; base-uri 'none'";
// Hero images are only ever served from the tenant's own static.* host.
const publicHeaders = site => ({
  'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src https://static.${site}; frame-ancestors 'none'; base-uri 'none'`,
});

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const noindex = (status, body = '', extra = {}) => new Response(body, { status, headers: { ...NOINDEX, ...extra } });
const json = (body, status = 200) => noindex(status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8' });

// Single statement so both store adapters can apply it verbatim. BIGINT is
// accepted by SQLite (type affinity) and native PostgreSQL alike.
// Roles that may carry custom HTML/CSS/JS (always served in the sandboxed wrapper).
const CUSTOM = new Set(['lp', 'ads', 'news']);
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'];
const UTM_VALUE = /^[\p{L}\p{N} _.,:+~/-]{1,100}$/u;
const B62 = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const contentSchema = `CREATE TABLE IF NOT EXISTS content(site TEXT, role TEXT, slug TEXT, title TEXT NOT NULL, paragraphs TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created BIGINT NOT NULL, updated BIGINT NOT NULL, published_at BIGINT, cta_label TEXT, cta_url TEXT, hero_image TEXT, custom_html TEXT, custom_css TEXT, custom_js TEXT, PRIMARY KEY(site, role, slug))`;
// Pretty public paths on the lp host pointing at shared static.* files.
export const vpathsSchema = `CREATE TABLE IF NOT EXISTS vpaths(site TEXT, path TEXT, file_id TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(site, path))`;
// Existing databases created before the custom-code columns: add them
// idempotently. Plain ADD COLUMN throws "duplicate column" on both SQLite
// and PostgreSQL once present; that failure is expected and ignored.
async function ensureSchema(store) {
  await store.run(contentSchema);
  for (const col of ['custom_html', 'custom_css', 'custom_js']) {
    try { await store.run(`ALTER TABLE content ADD COLUMN ${col} TEXT`); } catch { /* column exists */ }
  }
  await store.run(vpathsSchema);
}

// Call-to-action target: HTTPS only, no credentials, no IP literal. External
// targets are allowed - a CTA may point anywhere legitimate.
function validHttpsUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || /[\x00-\x20\x7f]/.test(raw)) fail(400, 'Invalid link');
  let u; try { u = new URL(raw); } catch { fail(400, 'Invalid link'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || isIP(h.replace(/^\[|\]$/g, ''))) fail(400, 'Invalid link');
  return u.href;
}
// Hero images come only from the tenant's own shared-file host, so no foreign
// tracking pixel can be embedded.
function validHero(raw, site) {
  if (raw === null || raw === undefined || raw === '') return null;
  const href = validHttpsUrl(raw);
  const u = new URL(href);
  if (u.hostname !== `static.${site}` || !/^\/[a-f0-9]{32}$/.test(u.pathname) || u.search) fail(400, `Hero image must be a shared file link from static.${site}`);
  return href;
}
// Virtual path validation: file-like lowercase paths; a single segment must
// contain a dot so virtual paths can never shadow a bare landing-page slug.
function validVpath(raw) {
  if (typeof raw !== 'string') return null;
  const path = raw.trim().toLowerCase();
  if (path.length < 2 || path.length > 160 || !VPATH.test(path) || path.includes('..') || path.endsWith('/') || path.endsWith('.')) return null;
  const segments = path.slice(1).split('/');
  if (VPATH_BLOCKED.has(segments[0])) return null;
  const last = segments.at(-1);
  if (segments.length < 2 && !last.includes('.')) return null;
  return path;
}
// Owner-authored custom code: text within size caps, no control characters
// beyond newline/tab. Empty means "not set". CSS/JS require HTML.
function cleanCode(value, limit, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail(400, `${label} must be text`);
  const text = value.replace(/\r\n?/g, '\n');
  if (text.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail(400, `Invalid ${label}`);
  return text;
}
function cleanCustom(value, role) {
  if (value === null || value === undefined) return { html: null, css: null, js: null };
  if (role === 'blog') fail(400, 'Custom code is only available for landing pages and ads');
  if (typeof value !== 'object') fail(400, 'Invalid custom code');
  const html = cleanCode(value.html, MAX_HTML, 'custom HTML');
  const css = cleanCode(value.css, MAX_CSS, 'custom CSS');
  const js = cleanCode(value.js, MAX_JS, 'custom JS');
  if (!html && (css || js)) fail(400, 'Custom CSS/JS requires custom HTML');
  return { html, css, js };
}

function cleanCta(value) {
  if (value === null || value === undefined) return { label: null, url: null };
  if (typeof value !== 'object') fail(400, 'Invalid call-to-action');
  const label = cleanText(value.label, 80, 'call-to-action label');
  if (label.includes('\n')) fail(400, 'Invalid call-to-action label');
  const url = validHttpsUrl(value.url);
  return { label, url };
}

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cleanText(value, limit, label) {
  if (typeof value !== 'string') fail(400, `${label} must be text`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text || text.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail(400, `Invalid ${label}`);
  return text;
}
function cleanParagraphs(value, allowEmpty = false) {
  if (allowEmpty && (value === undefined || value === null || (Array.isArray(value) && !value.length))) return [];
  if (!Array.isArray(value) || !value.length || value.length > MAX_PARAGRAPHS) fail(400, `1 to ${MAX_PARAGRAPHS} paragraphs required`);
  return value.map(p => cleanText(p, MAX_PARAGRAPH, 'paragraph'));
}
export function validSlug(raw) {
  if (typeof raw !== 'string' || !SLUG.test(raw) || RESERVED.has(raw)) return null;
  return raw;
}
export function slugify(title) {
  const text = title.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
    .slice(0, 60).replace(/^-+|-+$/g, '');
  return SLUG.test(text) && !RESERVED.has(text) ? text : 'eintrag';
}
const dateDE = ms => new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(ms));

// Assemble the document served inside the sandboxed frame: the owner's HTML
// as-is when it is a full document, otherwise wrapped; CSS before </head>,
// JS before </body>. All three parts come from the same authenticated owner,
// so no escaping applies here - the isolation boundary is the sandboxed
// opaque-origin iframe, not markup filtering.
function customDocument(record) {
  let doc = record.custom_html || '';
  if (!/<html[\s>]/i.test(doc)) {
    doc = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(record.title)}</title></head><body>${doc}</body></html>`;
  }
  if (record.custom_css) {
    const tag = `<style>\n${record.custom_css}\n</style>`;
    doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${tag}</head>`) : tag + doc;
  }
  if (record.custom_js) {
    const tag = `<script>\n${record.custom_js}\n</script>`;
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${tag}</body>`) : doc + tag;
  }
  return doc;
}
// Public/preview shell around the sandboxed frame: carries title, meta and
// the preview note; itself runs no custom code.
function customWrapper({ title, description, framePath, preview = false }) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title><meta name="description" content="${escapeHTML(description)}">${preview ? '<meta name="robots" content="noindex,nofollow">' : ''}
<style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100%;border:0}.note{position:fixed;left:0;right:0;bottom:0;z-index:2;background:#153658;color:#e9cd8d;font:13px system-ui;padding:6px 12px;text-align:center}</style></head>
<body><iframe src="${escapeHTML(framePath)}" title="${escapeHTML(title)}" sandbox="allow-scripts allow-forms allow-popups allow-top-navigation"></iframe>${preview ? '<p class="note">Entwurfsvorschau - nur mit Verwaltungszugang sichtbar.</p>' : ''}</body></html>`;
}

const pageCSS = `:root{color-scheme:dark;--bg:#0c2340;--panel:#112f51;--line:#294a6e;--text:#eee9df;--muted:#adbed2;--blue:#77a8ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top right,#173c64,transparent 65%),var(--bg);color:var(--text);font:16px/1.65 system-ui,sans-serif}header,main,footer{max-width:760px;margin:0 auto;padding:0 22px}header{padding-top:28px}header a{color:var(--muted);text-decoration:none;font:12px monospace;letter-spacing:.12em}h1{font:clamp(40px,6vw,64px)/1.1 Georgia,serif;letter-spacing:-.03em;margin:22px 0 10px}h1 a{color:var(--text);text-decoration:none}.date{color:var(--muted);font-size:14px;margin:0 0 34px}.post{border-top:1px solid var(--line);padding:26px 0}.post h2{font:28px/1.2 Georgia,serif;margin:0 0 6px}.post h2 a{color:var(--text);text-decoration:none}.post h2 a:hover{color:var(--blue)}.post .excerpt,.body p{color:var(--text)}.post .meta,.empty{color:var(--muted);font-size:14px}.body p{white-space:pre-line;margin:0 0 22px;font-size:18px}main{padding-bottom:40px}footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:22px;padding-bottom:48px}footer a{color:var(--blue)}.back{display:inline-block;margin:18px 0 0;color:var(--blue);text-decoration:none;font-size:14px}.hero{margin:64px 0 40px}.hero .body p{font-size:20px}.heroimg{display:block;width:100%;border-radius:20px;border:1px solid var(--line);margin:0 0 34px}.cta{display:inline-block;background:#78a9fa;color:#10233c;border:1px solid #87b5ff;font:600 16px/1.4 system-ui;border-radius:10px;padding:14px 22px;text-decoration:none;margin-top:8px}.cta:hover{background:#8cb6fb}.previewnote{border-left:2px solid #e9cd8d;background:#153658;padding:10px 16px;font-size:13px;color:#e9cd8d;margin:26px 0 0}`;

function layout({ site, role, title, description, body, manageLink = false }) {
  const main = `https://${site}`;
  const manage = manageLink ? ' · <a href="/manage" rel="nofollow">Verwalten</a>' : '';
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title><meta name="description" content="${escapeHTML(description)}">
<style>${pageCSS}</style></head>
<body><header><a href="${escapeHTML(main)}">${escapeHTML(site.toUpperCase())}</a></header>
<main>${body}</main>
<footer><a href="${escapeHTML(main)}">Zur Hauptseite</a> · <a href="${escapeHTML(main)}/impressum/">Impressum</a> · <a href="${escapeHTML(main)}/datenschutz/">Datenschutz</a>${manage}</footer></body></html>`;
}

async function readJSON(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON required');
  const length = Number(req.headers.get('content-length'));
  if (length > MAX_BODY) fail(413, 'Body too large');
  let size = 0; const chunks = []; const reader = req.body?.getReader();
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BODY) { await reader.cancel(); fail(413, 'Body too large'); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Invalid JSON'); }
}

export function createContentService({ store, site, managementHTML = '', managementAssets = {}, now = () => Date.now(), publicPerMinute = 600, authenticate = null, vendorDir = null, staticOrigin = null }) {
  const staticBase = staticOrigin || `https://static.${site}`;
  let ready;
  const init = () => ready ??= ensureSchema(store);
  const vendorCache = new Map();
  const num = value => value === null || value === undefined ? null : Number(value);
  const row = r => r && { slug: r.slug, title: r.title, status: r.status, created: num(r.created), updated: num(r.updated), published_at: num(r.published_at), cta_label: r.cta_label ?? null, cta_url: r.cta_url ?? null, hero_image: r.hero_image ?? null, has_custom: !!(r.custom_html || Number(r.custom_len ?? 0)) };

  async function publicPage(role, slug, head, preview = false) {
    if (role === 'news' && !preview) return null; // newsletters are never public web pages
    const record = await store.get('SELECT * FROM content WHERE site=? AND role=? AND slug=?', site, role, slug);
    const post = record && row(record);
    if (!post || (post.status !== 'published' && !preview)) return null;
    const paragraphs = JSON.parse(record.paragraphs);
    // Custom-code landing pages are served as a sandboxed-iframe wrapper.
    if (CUSTOM.has(role) && record.custom_html) {
      const description = paragraphs[0] ? paragraphs[0].slice(0, 155) : post.title;
      return { body: customWrapper({ title: post.title, description, framePath: `${preview ? '/preview-frame' : '/frame'}/${post.slug}`, preview }), head, custom: true };
    }
    let article;
    if (role === 'blog') {
      article = `<p class="date">Veröffentlicht am ${dateDE(post.published_at ?? post.created)}</p><h1>${escapeHTML(post.title)}</h1><div class="body">${paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}</div><a class="back" href="/">← Alle Beiträge</a>`;
    } else {
      const hero = post.hero_image ? `<img class="heroimg" src="${escapeHTML(post.hero_image)}" alt="" loading="lazy">` : '';
      const cta = post.cta_label && post.cta_url ? `<p><a class="cta" href="${escapeHTML(post.cta_url)}" rel="noopener">${escapeHTML(post.cta_label)}</a></p>` : '';
      article = `<div class="hero">${hero}<h1>${escapeHTML(post.title)}</h1><div class="body">${paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}</div>${cta}</div>`;
    }
    if (preview) article = `<p class="previewnote">Entwurfsvorschau - nur mit Verwaltungszugang sichtbar.</p>` + article;
    return { body: layout({ site, role, title: post.title, description: paragraphs[0] ? paragraphs[0].slice(0, 155) : post.title, body: article }), head, custom: false };
  }

  async function blogIndex() {
    const posts = (await store.all("SELECT slug,title,paragraphs,published_at,created FROM content WHERE site=? AND role='blog' AND status='published' ORDER BY published_at DESC", site)).map(r => ({ ...row(r), first: JSON.parse(r.paragraphs)[0] }));
    const items = posts.map(p => `<article class="post"><h2><a href="/${escapeHTML(p.slug)}">${escapeHTML(p.title)}</a></h2><p class="meta">${dateDE(p.published_at ?? p.created)}</p><p class="excerpt">${escapeHTML(p.first.length > 220 ? p.first.slice(0, 220).trimEnd() + ' …' : p.first)}</p></article>`).join('');
    return layout({ site, role: 'blog', title: `Blog | ${site}`, description: `Blog auf blog.${site}`, manageLink: true, body: `<h1>Blog</h1>${items || '<p class="empty">Noch keine Beiträge veröffentlicht.</p>'}` });
  }

  // The custom document itself, framed by the wrapper. Public frame route:
  // published pages only, and only for genuine iframe loads (direct tab
  // navigation would run the code on the manager's origin without the
  // sandbox, so browsers that report a non-iframe destination get 404).
  async function framePage(role, slug, preview, req) {
    if (role === 'news' && !preview) return null;
    const dest = req.headers.get('sec-fetch-dest');
    if (dest && dest !== 'iframe') return null;
    const record = await store.get('SELECT * FROM content WHERE site=? AND role=? AND slug=?', site, role, slug);
    if (!record || !CUSTOM.has(role) || !record.custom_html) return null;
    if (!preview && record.status !== 'published') return null;
    return customDocument(record);
  }

  async function throttle(role) {
    const bucket = Math.floor(now() / 60000);
    const requests = await store.transaction(async () => {
      await store.run('DELETE FROM public_limits WHERE site=? AND bucket<?', site, bucket - 1);
      await store.run('INSERT INTO public_limits VALUES(?,?,?,1) ON CONFLICT(site,role,bucket) DO UPDATE SET requests=public_limits.requests+1', site, role, bucket);
      return (await store.get('SELECT requests FROM public_limits WHERE site=? AND role=? AND bucket=?', site, role, bucket)).requests;
    });
    if (Number(requests) > publicPerMinute) return noindex(429, 'Rate limit reached', { 'retry-after': '60' });
    return null;
  }

  return async (req, role) => {
    try {
      await init();
      if (role !== 'blog' && !CUSTOM.has(role)) return noindex(404, 'Not found');
      const u = new URL(req.url);
      const head = req.method === 'HEAD';

      if (u.pathname.startsWith('/api/')) {
        if (authenticate && !await authenticate(req)) return noindex(401, 'Sign in required');
        return await api(req, role, u);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return noindex(405);
      const manageShell = () => noindex(200, head ? null : managementHTML.replace('<head>', `<head><meta name="content-role" content="${role}">`), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP });
      if (u.pathname === '/manage' && !u.search) return manageShell();
      // The LP host has no public index: its root opens the management shell.
      if (CUSTOM.has(role) && (u.pathname === '/' || u.pathname === '') && !u.search) return manageShell();
      if (managementAssets[u.pathname]) {
        const asset = managementAssets[u.pathname];
        return noindex(200, head ? null : asset.body, { 'content-type': asset.type, 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
      }
      // Vendored editor assets (Monaco/CodeMirror), read lazily and cached.
      if (vendorDir && u.pathname.startsWith('/vendor/')) {
        const rel = u.pathname.slice(8);
        const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.')) : '';
        if (!/^[a-zA-Z0-9._/-]+$/.test(rel) || rel.includes('..') || !VENDOR_MIME[ext]) return noindex(404, 'Not found');
        try {
          if (!vendorCache.has(rel)) vendorCache.set(rel, readFileSync(join(vendorDir, rel)));
          return noindex(200, head ? null : vendorCache.get(rel), { 'content-type': VENDOR_MIME[ext], 'cache-control': 'public, max-age=86400', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
        } catch { return noindex(404, 'Not found'); }
      }
      // Sandboxed-frame routes for custom landing pages. Preview first: it is
      // authenticated and renders drafts; the public frame is rate-limited
      // below like every public route.
      const pframe = u.pathname.match(/^\/preview-frame\/([a-z0-9-]{1,60})$/);
      if (pframe) {
        if (!authenticate || !await authenticate(req)) return noindex(authenticate ? 401 : 404, authenticate ? 'Sign in required' : 'Not found');
        const slug = validSlug(pframe[1]);
        const doc = slug && await framePage(role, slug, true, req);
        return doc ? noindex(200, head ? null : doc, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': FRAME_CSP }) : noindex(404, 'Not found');
      }
      // Authenticated draft preview. Never public: without an authenticate
      // hook (or a router that gates this path like the API) it stays 404.
      const prev = u.pathname.match(/^\/preview\/([a-z0-9-]{1,60})$/);
      if (prev) {
        if (!authenticate || !await authenticate(req)) return noindex(authenticate ? 401 : 404, authenticate ? 'Sign in required' : 'Not found');
        const slug = validSlug(prev[1]);
        const page = slug && await publicPage(role, slug, head, true);
        return page ? noindex(200, head ? null : page.body, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': page.custom ? WRAPPER_CSP : publicHeaders(site)['content-security-policy'] }) : noindex(404, 'Not found');
      }
      const limited = await throttle(role);
      if (limited) return limited;
      const frame = u.pathname.match(/^\/frame\/([a-z0-9-]{1,60})$/);
      if (frame) {
        const slug = validSlug(frame[1]);
        const doc = slug && await framePage(role, slug, false, req);
        return doc ? noindex(200, head ? null : doc, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': FRAME_CSP }) : noindex(404, 'Not found');
      }
      // Virtual file path: redirect to the shared file on the static host.
      // Only consulted for paths that cannot be landing-page slugs anyway.
      if (!u.search && !validSlug(u.pathname.slice(1))) {
        const vp = await store.get('SELECT file_id FROM vpaths WHERE site=? AND path=?', site, u.pathname.toLowerCase());
        if (vp) {
          const file = await store.get('SELECT shared FROM files WHERE site=? AND id=?', site, vp.file_id);
          if (file && Number(file.shared)) return noindex(302, null, { location: `${staticBase}/${vp.file_id}` });
          return noindex(404, 'Not found');
        }
      }
      if (role === 'blog' && (u.pathname === '/' || u.pathname === '') && !u.search) {
        return new Response(head ? null : await blogIndex(), { headers: { ...publicHeaders(site), 'content-type': 'text/html; charset=utf-8' } });
      }
      const slug = validSlug(u.pathname.slice(1));
      if (!slug || u.search) return noindex(404, 'Not found');
      const page = await publicPage(role, slug, head);
      if (!page) return noindex(404, 'Not found');
      const headers = { ...publicHeaders(site), 'content-type': 'text/html; charset=utf-8' };
      if (page.custom) headers['content-security-policy'] = WRAPPER_CSP;
      return new Response(head ? null : page.body, { headers });
    } catch (e) {
      return noindex(e instanceof HttpError ? e.status : 503, e instanceof HttpError ? e.message : 'Service unavailable');
    }
  };

  async function api(req, role, u) {
    // Shared static.* files and virtual path mappings, lp host only.
    if (req.method === 'GET' && u.pathname === '/api/assets') {
      if (!CUSTOM.has(role)) return noindex(404, 'Not found');
      const files = await store.all('SELECT id,name,length(content) AS size,shared FROM files WHERE site=? ORDER BY id DESC', site);
      const paths = await store.all('SELECT path,file_id,created FROM vpaths WHERE site=? ORDER BY path', site);
      const byId = new Map(files.map(f => [f.id, f]));
      return json({
        files: files.map(f => ({ id: f.id, name: f.name, size: num(f.size), shared: !!Number(f.shared), url: `${staticBase}/${f.id}` })),
        vpaths: paths.map(p => ({ path: p.path, file_id: p.file_id, file_name: byId.get(p.file_id)?.name ?? null, shared: !!(byId.get(p.file_id) && Number(byId.get(p.file_id).shared)) })),
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/vpaths') {
      if (!CUSTOM.has(role)) return noindex(404, 'Not found');
      const input = await readJSON(req);
      const path = validVpath(input.path);
      if (!path) fail(400, 'Invalid path');
      const fileId = String(input.file_id || '');
      if (!/^[a-f0-9]{32}$/.test(fileId)) fail(400, 'Invalid file');
      const file = await store.get('SELECT id FROM files WHERE site=? AND id=?', site, fileId);
      if (!file) fail(400, 'Unknown file');
      const r = await store.run('INSERT INTO vpaths(site,path,file_id,created) VALUES(?,?,?,?) ON CONFLICT(site,path) DO NOTHING', site, path, fileId, now());
      if (!r.changes) fail(409, 'Path already in use');
      return json({ path }, 201);
    }
    if (req.method === 'DELETE' && u.pathname === '/api/vpaths') {
      if (!CUSTOM.has(role)) return noindex(404, 'Not found');
      const input = await readJSON(req);
      const path = validVpath(input.path);
      if (!path) fail(400, 'Invalid path');
      const r = await store.run('DELETE FROM vpaths WHERE site=? AND path=?', site, path);
      return r.changes ? noindex(204, null) : noindex(404, 'Not found');
    }
    if (req.method === 'POST' && u.pathname === '/api/tracking-link') {
      const input = await readJSON(req);
      const slug = String(input.slug || '');
      if (!/^[a-z0-9-]{1,60}$/.test(slug)) fail(400, 'Invalid slug');
      const rec = await store.get("SELECT status FROM content WHERE site=? AND role=? AND slug=?", site, role, slug);
      if (!rec) return noindex(404, 'Not found');
      if (rec.status !== 'published') fail(409, 'Only published pages can be shared');
      const target = new URL(`https://${role}.${site}/${slug}`);
      const utm = input.utm && typeof input.utm === 'object' ? input.utm : {};
      for (const k of UTM_KEYS) {
        const v = utm[k];
        if (v === undefined || v === null || v === '') continue;
        if (typeof v !== 'string' || !UTM_VALUE.test(v.trim())) fail(400, `Invalid utm_${k}`);
        target.searchParams.set(`utm_${k}`, v.trim());
      }
      if (!target.searchParams.has('utm_source') || !target.searchParams.has('utm_campaign')) fail(400, 'utm_source and utm_campaign are required');
      const total = Number((await store.get('SELECT count(*) AS total FROM links WHERE site=?', site)).total);
      if (total >= 1000) fail(413, 'Link limit reached');
      const label = `${role.toUpperCase()} ${slug} · ${target.searchParams.get('utm_source')}/${target.searchParams.get('utm_campaign')}`.slice(0, 120);
      for (let i = 0; i < 5; i++) {
        const id = Array.from(randomBytes(6), b => B62[b % B62.length]).join('');
        const r = await store.run('INSERT INTO links(site,id,target,label,expires) VALUES(?,?,?,?,NULL) ON CONFLICT(site,id) DO NOTHING', site, id, target.href, label);
        if (r.changes) return json({ id, short: `https://l.${site}/${id}`, target: target.href }, 201);
      }
      fail(503, 'Could not allocate a link id');
    }
    const base = u.pathname === '/api/content' ? null : u.pathname.match(/^\/api\/content\/([a-z0-9-]{1,60})(\/status)?$/);
    if (req.method === 'GET' && u.pathname === '/api/content') {
      const items = (await store.all('SELECT slug,title,status,created,updated,published_at,cta_label,cta_url,hero_image,length(custom_html) AS custom_len FROM content WHERE site=? AND role=? ORDER BY updated DESC', site, role)).map(row);
      return json({ role, items });
    }
    if (req.method === 'POST' && u.pathname === '/api/content') {
      const input = await readJSON(req);
      const title = cleanText(input.title, MAX_TITLE, 'title');
      const custom = cleanCustom(input.custom, role);
      const paragraphs = JSON.stringify(cleanParagraphs(input.paragraphs, !!custom.html));
      const cta = cleanCta(input.cta);
      const hero = validHero(input.hero_image, site);
      const requested = input.slug === undefined || input.slug === null || input.slug === '' ? null : String(input.slug);
      if (requested !== null && !validSlug(requested)) fail(400, 'Invalid slug');
      const slug = await store.transaction(async () => {
        const total = Number((await store.get('SELECT count(*) AS total FROM content WHERE site=? AND role=?', site, role)).total);
        if (total >= MAX_ITEMS) fail(413, 'Site content cap reached');
        if (requested) {
          const r = await store.run('INSERT INTO content(site,role,slug,title,paragraphs,status,created,updated,cta_label,cta_url,hero_image,custom_html,custom_css,custom_js) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,role,slug) DO NOTHING', site, role, requested, title, paragraphs, 'draft', now(), now(), cta.label, cta.url, hero, custom.html, custom.css, custom.js);
          if (r.changes) return requested;
          fail(409, 'Slug already in use');
        }
        const baseSlug = slugify(title);
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = attempt ? `${baseSlug.slice(0, 56)}-${attempt + 1}` : baseSlug;
          const r = await store.run('INSERT INTO content(site,role,slug,title,paragraphs,status,created,updated,cta_label,cta_url,hero_image,custom_html,custom_css,custom_js) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,role,slug) DO NOTHING', site, role, candidate, title, paragraphs, 'draft', now(), now(), cta.label, cta.url, hero, custom.html, custom.css, custom.js);
          if (r.changes) return candidate;
        }
        fail(503, 'Please retry');
      });
      return json({ slug }, 201);
    }
    if (!base || !validSlug(base[1])) return noindex(404, 'Not found');
    const slug = base[1];
    if (req.method === 'GET' && !base[2]) {
      const item = await store.get('SELECT * FROM content WHERE site=? AND role=? AND slug=?', site, role, slug);
      if (!item) return noindex(404, 'Not found');
      return json({ ...row(item), paragraphs: JSON.parse(item.paragraphs), custom_html: item.custom_html ?? null, custom_css: item.custom_css ?? null, custom_js: item.custom_js ?? null });
    }
    if (req.method === 'POST' && !base[2]) {
      const input = await readJSON(req);
      const title = cleanText(input.title, MAX_TITLE, 'title');
      const custom = cleanCustom(input.custom, role);
      const paragraphs = JSON.stringify(cleanParagraphs(input.paragraphs, !!custom.html));
      const cta = cleanCta(input.cta);
      const hero = validHero(input.hero_image, site);
      const r = await store.run('UPDATE content SET title=?, paragraphs=?, updated=?, cta_label=?, cta_url=?, hero_image=?, custom_html=?, custom_css=?, custom_js=? WHERE site=? AND role=? AND slug=?', title, paragraphs, now(), cta.label, cta.url, hero, custom.html, custom.css, custom.js, site, role, slug);
      return r.changes ? json({ slug, updated: true }) : noindex(404, 'Not found');
    }
    if (req.method === 'POST' && base[2] === '/status') {
      const input = await readJSON(req);
      if (input.status !== 'draft' && input.status !== 'published') fail(400, 'Invalid status');
      const r = input.status === 'published'
        ? await store.run('UPDATE content SET status=?, updated=?, published_at=coalesce(published_at,?) WHERE site=? AND role=? AND slug=?', 'published', now(), now(), site, role, slug)
        : await store.run('UPDATE content SET status=?, updated=? WHERE site=? AND role=? AND slug=?', 'draft', now(), site, role, slug);
      return r.changes ? json({ slug, status: input.status }) : noindex(404, 'Not found');
    }
    if (req.method === 'DELETE' && !base[2]) {
      const r = await store.run('DELETE FROM content WHERE site=? AND role=? AND slug=?', site, role, slug);
      return r.changes ? noindex(204, null) : noindex(404, 'Not found');
    }
    return noindex(404, 'Not found');
  }
}
