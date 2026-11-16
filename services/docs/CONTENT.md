# Content service: blog and landing pages

`src/content.mjs` adds structured, plain-text blog posts (`blog.<site>`) and a slim landing-page manager (`lp.<site>`) to the services package. It is local code only: no provider, DNS, Git or deployment side effects.

## Interface

The content table gained `cta_label TEXT`, `cta_url TEXT`, `hero_image TEXT` (all nullable) in this pass; the owner had not applied `contentSchema` yet, so a fresh single-statement schema covers it - no migration needed.

```js
import { createContentService, contentSchema } from './src/content.mjs';

const handler = createContentService({
  store,            // existing Store (SQLite) or PostgresStore instance
  site,             // bare domain, e.g. 'philipp-paulik.de' (same tenant key as the base service)
  managementHTML,   // contents of public/content.html
  managementAssets, // { '/content.css': {body, type}, '/content.js': {body, type} } - same wiring as runtime.mjs does for manage.*
  now,              // optional clock, defaults to Date.now
  publicPerMinute,  // optional public rate limit per site+role, default 600
  authenticate,     // optional async (req) => truthy; enforced by this module when given
});

// The central router resolves the role from the exact verified hostname:
const response = await handler(request, 'blog'); // or 'lp'
```

`contentSchema` is a single `CREATE TABLE IF NOT EXISTS` statement valid in both SQLite and PostgreSQL. The handler also applies it lazily on first request, so either path is safe; applying it explicitly at migration time is still recommended.

## Routing contract (what the central router must do)

The handler covers every request path of the two host roles:

| Path | Access | Served by handler |
| --- | --- | --- |
| `GET /` (blog only) | public, before auth | published post index, discreet `/manage` link in the footer |
| `GET /` (lp) | unauthenticated shell | management shell directly (no public LP index exists) |
| `GET /<slug>` | public, before auth | published post (blog) or landing page (lp); drafts 404 |
| `GET /preview/<slug>` | authenticated (see below) | renders even drafts, with a preview banner, always `noindex` |
| `GET /manage` | unauthenticated shell, like `/manage` on db.* | `managementHTML` with an injected `<meta name="content-role">`; the page's data stays behind the API |
| `GET /content.css`, `/content.js` | unauthenticated | `managementAssets` |
| `/api/content/*` | **router MUST authenticate first** | CRUD (below) |

`/preview/<slug>` is never public: it requires the `authenticate` hook (401 when it fails, 404 when no hook is configured). A router that prefers its own gating should route `/preview/*` exactly like an authenticated API GET and can keep the hook unset.

The `/api/content/*` endpoints contain no session or CSRF logic of their own. The router must gate them exactly like `/api/*` in `src/service.mjs`: valid session cookie (`__Host-console`), and for mutations the same-origin check plus the `x-csrf-token` header check. The existing login endpoints (`/api/login`, `/api/session`, `/api/logout`) must be reachable on the `blog.*` and `lp.*` hosts too; `content.js` uses them unchanged. Alternatively, pass the `authenticate` option (e.g. a wrapper around the existing `session()` + `mutation()` checks) and this module enforces it on every API call itself.

Only the hostname selects tenant and role. Requests with a role other than `blog`/`lp` get 404.

## API

All under `/api/content`, same host, JSON only:

- `GET /api/content` → `{ role, items: [{ slug, title, status, created, updated, published_at }] }` (newest update first)
- `POST /api/content` `{ title, paragraphs, slug?, cta?, hero_image? }` → creates a draft, `201 { slug }`. Without `slug` one is derived from the title (German umlauts folded, collision-safe `-2` suffixes). Invalid or reserved slugs: 400; taken explicit slug: 409.
- `GET /api/content/:slug` → full item including `paragraphs`, `cta_*` and `hero_image`.
- `POST /api/content/:slug` `{ title, paragraphs, cta?, hero_image? }` → updates content; slug and status stay. Renaming = create new + delete old, so public links never silently break. `cta: null` / `hero_image: null` clears them.
- `POST /api/content/:slug/status` `{ status: 'draft' | 'published' }` → publish/unpublish. `published_at` is set on first publish and kept afterwards.
- `DELETE /api/content/:slug` → deletes; the slug becomes reusable.

Limits: 100 items per site+role, title 1-200 chars, 1-40 paragraphs of 1-4000 chars each, CTA label up to 80 chars (single line), JSON bodies capped at 64 KiB. Control characters are rejected.

### Landing-page CTA and hero image

Landing pages (`lp` role) optionally carry a call-to-action and a hero image; blog posts ignore both.

- `cta`: `{ label, url }`, both or neither. The URL must be HTTPS, without credentials or IP-literal hosts; external targets are allowed. Label and URL are stored plain and escaped on render; the link carries `rel="noopener"`.
- `hero_image`: only a shared-file link from the tenant's own file host, exactly `https://static.<site>/<32 lowercase hex>` (no query). This keeps foreign images - and with them third-party tracking pixels - out of every page. The public CSP is `img-src https://static.<site>` only. Uploads and sharing go through the existing file tool on `static.<site>`.

## Content model and rendering

Content is a title plus an array of plain-text paragraphs - never HTML or JS. Public pages escape every character, carry `default-src 'none'; style-src 'unsafe-inline'` CSP, set no cookies and do no visitor tracking (no counterpart to autonnel's tracking; the only write on public reads is the shared per-minute rate-limit bucket in `public_limits`, which the hourly `maintain()` already prunes). Line breaks inside a paragraph render as line breaks (`white-space: pre-line`). Public pages omit `x-robots-tag` so posts and landing pages can be indexed; `/manage` and all API responses are `noindex, nofollow`. Public pages link the site's `/impressum/` and `/datenschutz/` paths, matching the existing manage page.

Slugs: `^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$`; `manage`, `api`, `content`, `preview` are reserved. Empty database = empty blog ("Noch keine Beiträge veröffentlicht."); no seed or example content is shipped.

The public and management palettes reuse the package's design tokens (`#0c2340/#112f51/#77a8ff`, Georgia serif display headings). Management UI language is German.

## Tests and visual verification

- `node --test test/content.test.mjs` - 10 tests: idempotent schema, empty states, full draft→publish→edit→unpublish→delete lifecycle, HTML/JS escaping proof, slug rules (reserved/derived/unique/immutable), validation caps and item cap, CTA/hero validation incl. tenant-only hero host and clearing, LP root shell + blog manage link + gated draft preview, methods/HEAD/rate limit/role guard/`authenticate` hook, management-shell meta + noindex, and a PostgreSQL-dialect run of the schema and lifecycle through `PostgresStore` (PGlite).
- `node test/content-visual.mjs` - loopback harness (stubbed session endpoint and `authenticate`; auth is the router's job) plus Playwright: gate, console, editor, mobile widths (no horizontal overflow at 390px), public blog index/post, LP manager at `/manage` and `/`, public LP with CTA + hero (static.* image intercepted with an SVG fixture), draft preview. Screenshots land in `/downloads/content-*.png`; the script exits non-zero on any page error.
- The full existing suite (`npm test`, `npm run check`) still passes: 31 tests total.

Fixture slugs and screenshots marked "BEISPIEL" are generated locally by the harness only; nothing is seeded into any real database.
