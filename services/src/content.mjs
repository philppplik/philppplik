// Structured blog and landing-page content service. Plain-text titles and
// paragraphs only: no HTML/JS is accepted or rendered from content, every
// public page escapes text and ships a restrictive CSP. Local module - no
// provider, DNS, Git or deployment side effects.
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

const MAX_ITEMS = 100;
const MAX_TITLE = 200;
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH = 4000;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED = new Set(['manage', 'api', 'content', 'preview']);
const NOINDEX = {
  'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
};
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
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
export const contentSchema = `CREATE TABLE IF NOT EXISTS content(site TEXT, role TEXT, slug TEXT, title TEXT NOT NULL, paragraphs TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created BIGINT NOT NULL, updated BIGINT NOT NULL, published_at BIGINT, cta_label TEXT, cta_url TEXT, hero_image TEXT, PRIMARY KEY(site, role, slug))`;

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
function cleanParagraphs(value) {
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
  if (length > 65536) fail(413, 'Body too large');
  let size = 0; const chunks = []; const reader = req.body?.getReader();
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); fail(413, 'Body too large'); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Invalid JSON'); }
}

export function createContentService({ store, site, managementHTML = '', managementAssets = {}, now = () => Date.now(), publicPerMinute = 600, authenticate = null }) {
  let ready;
  const init = () => ready ??= store.run(contentSchema);
  const num = value => value === null || value === undefined ? null : Number(value);
  const row = r => r && { slug: r.slug, title: r.title, status: r.status, created: num(r.created), updated: num(r.updated), published_at: num(r.published_at), cta_label: r.cta_label ?? null, cta_url: r.cta_url ?? null, hero_image: r.hero_image ?? null };

  async function publicPage(role, slug, head, preview = false) {
    const record = await store.get('SELECT * FROM content WHERE site=? AND role=? AND slug=?', site, role, slug);
    const post = record && row(record);
    if (!post || (post.status !== 'published' && !preview)) return null;
    const paragraphs = JSON.parse(record.paragraphs);
    let article;
    if (role === 'blog') {
      article = `<p class="date">Veröffentlicht am ${dateDE(post.published_at ?? post.created)}</p><h1>${escapeHTML(post.title)}</h1><div class="body">${paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}</div><a class="back" href="/">← Alle Beiträge</a>`;
    } else {
      const hero = post.hero_image ? `<img class="heroimg" src="${escapeHTML(post.hero_image)}" alt="" loading="lazy">` : '';
      const cta = post.cta_label && post.cta_url ? `<p><a class="cta" href="${escapeHTML(post.cta_url)}" rel="noopener">${escapeHTML(post.cta_label)}</a></p>` : '';
      article = `<div class="hero">${hero}<h1>${escapeHTML(post.title)}</h1><div class="body">${paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}</div>${cta}</div>`;
    }
    if (preview) article = `<p class="previewnote">Entwurfsvorschau - nur mit Verwaltungszugang sichtbar.</p>` + article;
    return { body: layout({ site, role, title: post.title, description: paragraphs[0].slice(0, 155), body: article }), head };
  }

  async function blogIndex() {
    const posts = (await store.all("SELECT slug,title,paragraphs,published_at,created FROM content WHERE site=? AND role='blog' AND status='published' ORDER BY published_at DESC", site)).map(r => ({ ...row(r), first: JSON.parse(r.paragraphs)[0] }));
    const items = posts.map(p => `<article class="post"><h2><a href="/${escapeHTML(p.slug)}">${escapeHTML(p.title)}</a></h2><p class="meta">${dateDE(p.published_at ?? p.created)}</p><p class="excerpt">${escapeHTML(p.first.length > 220 ? p.first.slice(0, 220).trimEnd() + ' …' : p.first)}</p></article>`).join('');
    return layout({ site, role: 'blog', title: `Blog | ${site}`, description: `Blog auf blog.${site}`, manageLink: true, body: `<h1>Blog</h1>${items || '<p class="empty">Noch keine Beiträge veröffentlicht.</p>'}` });
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
      if (role !== 'blog' && role !== 'lp') return noindex(404, 'Not found');
      const u = new URL(req.url);
      const head = req.method === 'HEAD';

      if (u.pathname.startsWith('/api/content')) {
        if (authenticate && !await authenticate(req)) return noindex(401, 'Sign in required');
        return await api(req, role, u);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return noindex(405);
      const manageShell = () => noindex(200, head ? null : managementHTML.replace('<head>', `<head><meta name="content-role" content="${role}">`), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP });
      if (u.pathname === '/manage' && !u.search) return manageShell();
      // The LP host has no public index: its root opens the management shell.
      if (role === 'lp' && (u.pathname === '/' || u.pathname === '') && !u.search) return manageShell();
      if (managementAssets[u.pathname]) {
        const asset = managementAssets[u.pathname];
        return noindex(200, head ? null : asset.body, { 'content-type': asset.type, 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
      }
      // Authenticated draft preview. Never public: without an authenticate
      // hook (or a router that gates this path like the API) it stays 404.
      const prev = u.pathname.match(/^\/preview\/([a-z0-9-]{1,60})$/);
      if (prev) {
        if (!authenticate || !await authenticate(req)) return noindex(authenticate ? 401 : 404, authenticate ? 'Sign in required' : 'Not found');
        const slug = validSlug(prev[1]);
        const page = slug && await publicPage(role, slug, head, true);
        return page ? noindex(200, head ? null : page.body, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': publicHeaders(site)['content-security-policy'] }) : noindex(404, 'Not found');
      }
      const limited = await throttle(role);
      if (limited) return limited;
      if (role === 'blog' && (u.pathname === '/' || u.pathname === '') && !u.search) {
        return new Response(head ? null : await blogIndex(), { headers: { ...publicHeaders(site), 'content-type': 'text/html; charset=utf-8' } });
      }
      const slug = validSlug(u.pathname.slice(1));
      if (!slug || u.search) return noindex(404, 'Not found');
      const page = await publicPage(role, slug, head);
      return page ? new Response(head ? null : page.body, { headers: { ...publicHeaders(site), 'content-type': 'text/html; charset=utf-8' } }) : noindex(404, 'Not found');
    } catch (e) {
      return noindex(e instanceof HttpError ? e.status : 503, e instanceof HttpError ? e.message : 'Service unavailable');
    }
  };

  async function api(req, role, u) {
    const base = u.pathname === '/api/content' ? null : u.pathname.match(/^\/api\/content\/([a-z0-9-]{1,60})(\/status)?$/);
    if (req.method === 'GET' && u.pathname === '/api/content') {
      const items = (await store.all('SELECT slug,title,status,created,updated,published_at,cta_label,cta_url,hero_image FROM content WHERE site=? AND role=? ORDER BY updated DESC', site, role)).map(row);
      return json({ role, items });
    }
    if (req.method === 'POST' && u.pathname === '/api/content') {
      const input = await readJSON(req);
      const title = cleanText(input.title, MAX_TITLE, 'title');
      const paragraphs = JSON.stringify(cleanParagraphs(input.paragraphs));
      const cta = cleanCta(input.cta);
      const hero = validHero(input.hero_image, site);
      const requested = input.slug === undefined || input.slug === null || input.slug === '' ? null : String(input.slug);
      if (requested !== null && !validSlug(requested)) fail(400, 'Invalid slug');
      const slug = await store.transaction(async () => {
        const total = Number((await store.get('SELECT count(*) AS total FROM content WHERE site=? AND role=?', site, role)).total);
        if (total >= MAX_ITEMS) fail(413, 'Site content cap reached');
        if (requested) {
          const r = await store.run('INSERT INTO content(site,role,slug,title,paragraphs,status,created,updated,cta_label,cta_url,hero_image) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,role,slug) DO NOTHING', site, role, requested, title, paragraphs, 'draft', now(), now(), cta.label, cta.url, hero);
          if (r.changes) return requested;
          fail(409, 'Slug already in use');
        }
        const baseSlug = slugify(title);
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = attempt ? `${baseSlug.slice(0, 56)}-${attempt + 1}` : baseSlug;
          const r = await store.run('INSERT INTO content(site,role,slug,title,paragraphs,status,created,updated,cta_label,cta_url,hero_image) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,role,slug) DO NOTHING', site, role, candidate, title, paragraphs, 'draft', now(), now(), cta.label, cta.url, hero);
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
      return json({ ...row(item), paragraphs: JSON.parse(item.paragraphs) });
    }
    if (req.method === 'POST' && !base[2]) {
      const input = await readJSON(req);
      const title = cleanText(input.title, MAX_TITLE, 'title');
      const paragraphs = JSON.stringify(cleanParagraphs(input.paragraphs));
      const cta = cleanCta(input.cta);
      const hero = validHero(input.hero_image, site);
      const r = await store.run('UPDATE content SET title=?, paragraphs=?, updated=?, cta_label=?, cta_url=?, hero_image=? WHERE site=? AND role=? AND slug=?', title, paragraphs, now(), cta.label, cta.url, hero, site, role, slug);
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
