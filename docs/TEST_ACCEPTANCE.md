# Test and Acceptance Plan

## Automated tests

### Server

- Zod validation and stable error envelopes for every new endpoint.
- Owner/admin/analyst/client-viewer permission matrix.
- Client creation transaction provisions the access team.
- Site assignment rejects cross-organization and duplicate-client sites.
- Client summaries cannot include inaccessible sites.
- Report scheduling validates timezone and cadence and remains idempotent.
- Audit events contain no secrets or report-recipient content beyond required identifiers.
- Tracking plan/apply/status/rollback rejects non-admin users, cross-client source IDs, and concurrent jobs for one site.
- Cloudflare planning blocks inherited route conflicts; apply verifies live injection/proxy headers; rollback removes only the managed site route.
- Vercel output contains only the public analytics origin and site ID and never overwrites existing instrumentation.
- Restrictive Vite/static CSP headers in `vercel.json` are patched idempotently across all route policies without adding wildcards or changing unrelated directives.
- Assertion tests cover signing, opaque ID stability, expiration, tampering, wrong-site use, trait normalization, allowlisting, 2 KB limits, replay rejection, Redis failure, and key rotation grace.
- Direct unsigned identification remains disabled by default and cannot persist a browser ID after server rejection.
- Public/private-link access to user lists, searches, traits, and user detail is rejected.
- Medical/legal compliance-blocked sites cannot create or enable identity keys.

### Client

- Agency API hooks include all inputs in React Query keys.
- Portfolio, client list, client overview, and onboarding render loading, empty, error, and permission states.
- Preline initializes after hydration and route changes without duplicate handlers.
- Navigation and filters remain keyboard accessible and URL-persisted where required.

### Integration and end-to-end

- Postgres, ClickHouse, Redis, client, and server start from a clean Compose environment.
- Public tracking writes pageviews and conversions without raw IP storage.
- Two users assigned to different clients cannot cross-read via UI, direct URLs, API IDs, exports, or report links.
- GSC and Resend use mocks in CI; live credentials are verified only in staging.
- Cloudflare, Vercel, and GitHub use mocks in CI; live provider plans are read-only until an owner confirms apply.
- Backup restoration reconstructs authentication, access, analytics, and reporting state.
- A delivered GHL fixture returns an assertion and links the preceding anonymous session; failed delivery, honeypot, and webhook fallback return no assertion.
- Assert that phone, message, service, address, health/legal details, and provider response bodies are absent from Postgres, ClickHouse, Redis values, logs, URLs, and reports.

## Performance

- Run ingestion at five times projected peak traffic.
- Event acceptance above 99.9%; queue lag below one minute.
- Thirty-day portfolio/client queries below two seconds at p95.
- Report jobs do not degrade ingestion or interactive query SLOs.

## Accessibility and browser QA

- WCAG 2.2 AA automated checks plus keyboard and focus review.
- Desktop, tablet, and mobile layouts.
- Light/dark themes and reduced motion.
- First load and client-side navigation in current Chromium, Firefox, and Safari.

## Production release gate

- Three pilot sites send verified events within 15 minutes of installation.
- Fourteen-day Rybbit/GA4 comparison is reviewed and differences are documented.
- Tenant isolation suite, load test, backup age check, and restore drill pass.
- No high-severity open finding affects a v1 route.
- Rollback to the previous image SHA is proven in staging.
