# Release readiness

## Implemented and tested locally

- Host-isolated routing for the five portfolio tools.
- Separate tool authentication with host-only cookies, same-origin and CSRF checks.
- File upload/recode/private-sharing lifecycle.
- Short-code creation, target/label editing, disable/reactivate/delete and daily aggregate counts.
- Blog and landing-page CRUD, drafts, publication and authenticated previews.
- LP call-to-action and own-static-host hero image validation.
- Fixed-upstream encrypted GA4 view, without changing the existing publisher.
- SQLite, PGlite and native PostgreSQL tests, including concurrency/restart/rollback.
- Real central-auth browser interactions at desktop and mobile widths.
- Runtime dependency audit with no reported advisories at the release check.

## External acceptance checklist

A successful upload is not the same as a working custom domain. These checks must be completed against the actual deployment:

1. Public DNS returns the intended CNAME for all five names.
2. A valid TLS certificate covers all five names.
3. Every host stays on its own origin, including management and session endpoints.
4. Public shells render correctly; private APIs and draft previews reject anonymous reads.
5. The new tool login succeeds and the existing GA4 password still unlocks the encrypted view.
6. Private production smoke-test drafts/files are removed; no fake posts are published.
7. Netlify/Neon remain on their free plans, with no paid add-ons.

## Boundaries

Not included: a complete Autonnel migration, ecommerce, email campaigns, lead forms, multi-user authorization, malware scanning, independent scheduled backup, legal-policy audit, or changes to the main portfolio/editorial sites. The database is in Frankfurt; the free backend runs in Ohio. Quota pauses and cold starts are expected.

## Production acceptance, 2026-11-16

All five custom hosts resolve to the isolated project and serve their own HTTPS origin. Let's Encrypt certificate covers the exact five names; forced HTTPS is enabled. The new project's default Netlify-login wall was disabled so published pages and short links are usable without provider login. Application authentication remains required for every private API and draft preview.

Actual password sign-in/session checks passed on all five hosts. Live checks covered private file upload and anonymous denial, shortlink creation/redirect/edit/disable, blog and LP draft create/edit, anonymous draft denial, anonymous preview denial, authenticated preview access, role API isolation and deletion. Every smoke-test file/link/draft/count was removed and empty lists confirmed. Nothing was published.

The existing GA4 password successfully decrypted the proxied view in-browser. It showed a snapshot from 2026-11-16 07:53 Europe/Berlin; the existing publisher and password were not changed. Actual desktop/mobile public views rendered without page errors or horizontal overflow. Visual inspection caught and fixed the empty blog's repeating background. Authenticated static management and decrypted analytics were visually checked live.

The local native database fixture needs its platform package's normal install script (`npm rebuild @embedded-postgres/linux-x64` on Linux x64) if dependencies were installed with `--ignore-scripts`. Runtime dependency packaging must use a real `node_modules` directory, not a symlink: the latter produced an invalid deployment archive and was replaced before acceptance.

This accepts the initial service deployment, not an uptime guarantee or legal audit. The project is manually deployed; a PR merge in the portfolio repository does not automatically deploy these services.
