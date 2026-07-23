# Agency Analytics Delivery Roadmap

## Current status

- M0 product, technical, security, operations, wireframe, test, and OpenKnowledge foundations are complete. Provider contract and privacy approvals remain external activation gates.
- M1 is live in production on Hetzner with the Preline agency shell, immutable-SHA releases, hardened Compose, backups, TOTP, Cloudflare edge controls, and browser smoke checks.
- M2 is complete with schema, APIs, UI, tracking verification, audit events, tenant-isolation tests, and zero-touch managed tracking for supported Vercel and Cloudflare paths. Restrictive Vercel CSP is patched in the same preview-first change.
- M3 client summary metrics are live in code; acquisition/content/GSC/Web Vitals portfolio aggregation and performance validation remain.
- M4 reporting is complete with BullMQ workers, private encrypted artifacts, signed downloads, retries, and Resend delivery.
- M5 production is live. The three-site GA4 comparison, projected-load test, and first clean-environment restoration drill remain launch gates before broad client onboarding.
- Provider-neutral identity is implemented on PR `#21`, disabled by default, and hardened against replay loss, retry cost inflation, pre-commit external side effects, lost provider-deletion jobs, failed consent withdrawal, cross-site consent reuse, invalid pricing, and stale optimistic settings. No provider can activate before its contract, data-rights, deletion, health, pricing, and budget gates pass.

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
- [x] Move the proven tracking provider contract behind queued agency APIs and expose plan/apply/status/rollback from onboarding without returning provider credentials to the browser.

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

Replay consent, errors, retention, funnels, journeys, advanced events, GA4 import, Slack, Command Center integration, client managers, and per-client domains.

## Identified users rollout

- [x] Signed assertions, encrypted per-site keys, Vercel environment provisioning, production redeploy status, replay protection, kill switch, retention, authenticated Users UI, and audit events.
- [x] Palm Squad GHL adapter and browser handoff; enable after the analytics release and Vercel preview pass.
- [ ] Cummings Pest: replace simulated success with real CRM delivery before adding an adapter.
- [ ] R2 Law: add delivery, remove remaining PII logs, and obtain attorney-privacy approval. Server policy blocks enablement.
- [ ] Accident Doctor, Neuron Connect, and Arizona Tattoo Removal: adapter work remains disabled behind medical/health compliance approval. Server policy blocks key creation and enablement.
