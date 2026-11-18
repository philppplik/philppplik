# Portfolio services

Five host-isolated tools for `philipp-paulik.de`. Node.js serverless functions on Netlify Free, PostgreSQL on Neon Free in Frankfurt. Netlify Free functions run in Ohio, US; the database location does not mean all processing stays in the EU. There is no paid region override.

## Hosts

| Host | Entry point | Purpose |
| --- | --- | --- |
| `analytics` | `/`, `/manage` | Existing encrypted GA4 dashboard in place; aggregate short-link statistics under `/manage` |
| `static` | `/` or `/upload` | Private files, explicit link sharing, withdrawal and deletion |
| `l` | `/` | Short-link manager, optional custom codes, edit/disable/delete, daily redirect counts |
| `blog` | `/`, `/manage` | Public published-post index and protected editor |
| `lp` | `/` | Landing-page manager, text, CTA, own-host hero image, drafts and protected previews |

The tools keep their own host. No wildcard tenant selection or client-supplied forwarded host is trusted. The existing portfolio, db dashboard and editorial sites are separate and are not deployed by this project.

## Authentication and privacy

- Tools use a separate generated password. Only an scrypt salt/hash verifier is configured on the server. The existing GA4 dashboard still uses its existing password and browser-side decryption.
- One-hour `__Host-console` cookies are Secure, HttpOnly, SameSite=Strict and host-only. Each host needs its own sign-in. Mutations require same-origin and a session CSRF token.
- All content APIs and draft previews require a valid session. Public routes return only published content. No sample posts or pages are seeded.
- No visitor identifiers, marketing beacons or visitor cookies are added. Short-link counts are redirect requests, not unique people; UTC daily counts are retained for 90 days. Bots/previews are filtered heuristically, not perfectly.
- Provider access logs may still process network information. This is not a claim that the hosting providers collect no IP data. Existing legal notices should be reviewed for the new Neon/US data flow before sensitive or third-party data is used.
- Public GA4 assets/ciphertext are fetched only from the fixed existing db host, with a five-minute in-memory cache. After a signed-in session, the Netlify function (US region) decrypts the snapshot server-side with `GA_DASHBOARD_PASSWORD` (a secret Netlify variable, set with Philipp's approval on 2026-11-16) and returns it only to that session at `/api/ga`; the ciphertext on db. is unchanged and the password is never sent to the browser. If the source is unavailable, analytics returns 503 rather than stale invented metrics.

## Limits and availability

Files: 4 MiB each, 100 MiB total. Formats: PDF, ZIP, UTF-8 text/CSV, PNG/JPEG/WebP. Raster images are decoded and recoded to PNG; other files are opaque download attachments. No virus scanner is included. Sharing makes a file downloadable by anyone who has its link; withdrawing a link cannot revoke downloaded copies.

Hosts: analytics, static, l, blog, lp, ads (custom-code ads, sandboxed exactly like lp) and m (login-gated overview). Tracking links: `POST /api/tracking-link` on lp/ads creates an `l.` short link with validated UTM parameters for a published page.

Links: 1,000 per site. Content: 100 entries per role, title 200 characters, up to 40 paragraphs of 4,000 characters. Landing pages stay a slim manager by default (text, CTA, own-host hero image), not Autonnel's commerce/funnel builder: no payments, forms, automations or ad integrations. Owners can additionally opt a landing page into custom HTML/CSS/JS, edited with locally vendored Monaco or CodeMirror. Custom pages are always served inside a sandboxed iframe wrapper (no same-origin), so custom code never runs in the manager's origin. Virtual file paths (for example `/bilder/cover.jpg`) redirect to shared files on the tenant's own `static.*` host.

Free provider quotas are hard limits, not an uptime promise. Netlify can pause the whole team when credits run out, including other projects in that team. Neon can pause compute/transfer at quota. Cold starts are expected. The free six-hour database history is not an independent long-term backup. Do not enable paid overages or upgrades without approval.

## Development

Requires Node.js 22.13 or later.

```sh
npm ci
npm run check
npm test
node test/integrated-visual.mjs
```

The code editors are vendored build artifacts under `public/vendor/`, served same-origin. `codemirror.js` is an esbuild bundle of the CodeMirror 6 packages; `monaco/` is an esbuild bundle of monaco-editor (editor API + HTML/CSS/JS language services) plus its four workers. Monaco's internally vendored DOMPurify copy was replaced with the current upstream release at bundle time (verify `version="…"` in `public/vendor/monaco/monaco.js` after any rebuild). Rebuild both with esbuild when upgrading; no CDN is involved at runtime.

Tests use explicitly local fixtures. The central-router integration test verifies authentication, CSRF, host isolation and draft-preview protection. The native PostgreSQL test selects an ephemeral port and uses four worker processes to verify atomic counts, rollback and restart persistence. Runtime dependencies should be audited with `npm audit --omit=dev`.

## Deployment

Secrets are never committed. Server environment:

- `DATABASE_URL`: PostgreSQL connection with `sslmode=verify-full`.
- `TOOLS_VERIFIER`: JSON `{salt,hash}` from `passwordVerifier` in `src/service.mjs`.

Run the schema migration (`schema` from `src/postgres.mjs`, then `contentSchema` from `src/content.mjs`) against a newly created database before deployment. Production migrations must preserve existing rows. This release starts with an empty content table; it does not migrate an older content schema automatically.

Authenticate the official Netlify CLI, link only the dedicated services project, import the private environment file, then run `netlify deploy` for a preview and `netlify deploy --prod` for production. Do not set a function region on Free. Native `sharp` must be bundled for the deployment architecture. `netlify.toml` includes only public UI assets, never the environment file or source publish directory.

After DNS propagation, verify all five exact hostnames, TLS certificate coverage, no cross-host redirects, unauthorized API denial, sign-in, private file lifecycle, link mutations, empty content states and protected draft previews. Never publish fixture posts or landing pages into production for a smoke test.

## Operations

Hourly retention cleanup is demand-driven on API requests, not a paid cron. Session expiry and retention are also enforced on access/write paths. Configure independent encrypted backups before keeping irreplaceable data. Export and restore helpers are inherited local utilities, not a claim that an automated cloud backup has been configured.

See [content API](docs/CONTENT.md) and [readiness](docs/READINESS.md).
