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
