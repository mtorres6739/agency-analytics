# Agency Analytics Delivery Roadmap

## Current status

- M0 implementation complete locally; legal review remains an owner release gate.
- M1 code foundation complete; staging deployment and browser QA remain.
- M2 vertical slice complete with schema, APIs, UI, tracking verification, audit events, and tenant-isolation tests.
- M3 client summary metrics are live in code; acquisition/content/GSC/Web Vitals portfolio aggregation and performance validation remain.
- M4 reporting control plane is complete; workers, artifacts, signed downloads, and Resend delivery remain.
- M5 requires provisioned Hetzner environments and pilot clients.
- Managed tracking operator tooling is implemented for Cloudflare-proxied origins and Next.js 15.3+ Vercel/GitHub projects. The first exact site mapping, browser preview, and ingestion pilot remain gated.

## M0: Foundation

- Pin upstream and establish sync/product branches.
- Revalidate high-severity v1 findings in `FEATURE_AUDIT.md`.
- Complete product, technical, security, operations, wireframe, and test contracts.
- Establish OpenKnowledge project context.

Exit: baseline builds/tests are understood, licenses are recorded, and v1 scope is decision-complete.

## M1: Design and staging

- Harden Compose and release workflow.
- Deploy staging.
- Integrate Preline with Next.js/Tailwind v4.
- Deliver agency shell, responsive navigation, core states, and auth presentation.

Exit: first load and client navigation initialize Preline once with no console errors.

## M2: Tenancy and onboarding

- Add agency schema and migration.
- Add client CRUD, site assignment, access checks, and audit events.
- Build portfolio, clients, client overview, and onboarding.
- Move the proven tracking provider contract behind queued agency APIs and expose plan/apply/status/rollback from the onboarding wizard without returning provider credentials to the browser.

Exit: automated two-client isolation tests pass.

## M3: Analytics core

- Traffic, acquisition, content, goals/conversions, GSC, Web Vitals, and uptime.
- URL-persisted period/client/site filters.
- Normalize API error handling for the consumed endpoints.

Exit: core p95 target is met at expected load.

## M4: Reporting

- Schedules, recipients, runs, retries, private artifacts, signed links, PDF, and Resend.

Exit: idempotent weekly/monthly reports deliver above 99% after retries.

## M5: Pilot and production

- Three-site, 14-day GA4 parallel pilot.
- Security, accessibility, load, backup, and restore gates.
- Production release and batched client onboarding.

## Post-v1

Replay consent, errors, users, retention, funnels, journeys, advanced events, GA4 import, Slack, Command Center integration, client managers, and per-client domains.
