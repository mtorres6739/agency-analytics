---
title: Agency Analytics project overview
type: overview
status: canonical
tags: [analytics, rybbit, agency, hetzner, preline]
---

# Agency Analytics project overview

This repository is a maintained AGPL fork of Rybbit for agency-wide client analytics. It preserves the upstream tracking and analytics engine and adds agency clients, restricted client access, branded reporting, privacy defaults, operations, and a Preline-based agency shell.

## Start here

- [Product requirements](../docs/PRD.md)
- [Technical specification](../docs/TECHNICAL_SPEC.md)
- [Wireframes](../docs/WIREFRAMES.md)
- [Security and privacy](../docs/SECURITY_PRIVACY.md)
- [Operations](../docs/OPERATIONS.md)
- [Roadmap](../docs/ROADMAP.md)
- [Test and acceptance](../docs/TEST_ACCEPTANCE.md)
- [Upstream audit revalidation](../docs/UPSTREAM_AUDIT_REVALIDATION.md)
- [Provider-neutral identity operations](../docs/PROVIDER_IDENTITY.md)

## Durable boundaries

- Upstream baseline is recorded in the PRD and deployment releases are pinned to Git SHAs.
- Custom agency code stays in agency-specific namespaces.
- Postgres owns configuration and access; ClickHouse owns analytics; Redis owns sessions and queues.
- The server derives every allowed site set. Client IDs and site IDs never authorize access.
- Secrets stay server-side. Session replay and IP storage are off by default.
- Preline public/MIT-compatible assets are used for the agency shell; premium assets require separate authorization and license review.

## Implementation snapshot

Implemented on `codex/agency-analytics-v1` against upstream `3ac02f2d4983fb4865e02e22732ff2bba3512cf0`:

- Drizzle migration `0012_clean_silver_samurai.sql` adds agency clients/sites, schedules/recipients/runs, and audit events.
- `server/src/api/agency/` owns tenant-safe client CRUD, site assignment/removal/verification, 30-day ClickHouse summaries, onboarding state, report schedule CRUD, run history, and retry commands.
- `shared/src/agency.ts` is the cross-runtime contract source.
- `/portfolio`, `/clients`, `/clients/[clientId]`, and `/reports` use the public Preline runtime through `preline/non-auto` and preserve canonical Rybbit site dashboards.
- `infra/agency/` owns the Hetzner production overlay, hardened Caddy policy, immutable-SHA deploy/rollback script, and encrypted offsite backup script.
- `infra/tracking-edge/` installs a same-origin tracker through site-scoped Cloudflare Workers for already-proxied WordPress or Vercel domains, with explicit manifests and plan/apply/verify/rollback gates.
- `infra/tracking-vercel/` discovers a Vercel project's GitHub source and opens a preview-first managed tracker PR for supported Next.js and Vite projects.
- Client onboarding exposes the provider contract through tenant-scoped BullMQ jobs and durable `tracking_deployments` records. Operator-created plans are read-only until confirmed; site-creation plans can carry the production-only automatic-apply policy. Applies, status refreshes, and rollback remain bound to the assigned site and store sanitized results only.
- Standard website creation now provisions the agency client/team/site boundary and enqueues a zero-touch managed deployment. Cloudflare applies directly; Vercel waits for a successful preview before merging. Older App Router projects receive a managed root-layout tracker, Vite projects receive a managed `index.html` tracker, and the empty analytics dashboard displays deployment state instead of generic manual instructions.
- Restrictive Vercel CSP stored in `vercel.json` is part of the same managed change for both Next.js and Vite/static projects. The installer updates every CSP header rule with the exact analytics origin in `script-src` and `connect-src`, preserves all other sources/directives, and remains idempotent; unsupported CSP shapes stay blocked.
- Installer jobs use the internal numeric site ID only for tenancy, branch names, and Worker script names. Injected browser tracking must use the public `sites.id` property token (for example Neuron Connect uses `22256ab1cdfe`), never the numeric database key.
- `.github/workflows/agency-images.yml` verifies and publishes commit-SHA images to GHCR.
- Better Auth TOTP, encrypted backup codes, account lockout, and server-side privileged-role enforcement protect agency owners and administrators.
- The Next.js proxy must keep `/two-factor` in its built-in single-segment route set; otherwise the generic site canonicalizer rewrites the authentication challenge to `/two-factor/main` and prevents privileged users from completing sign-in.
- `server/src/services/agencyReports/` dispatches due schedules through BullMQ, renders private PDFs, stores encrypted S3 artifacts, creates seven-day signed downloads, sends aggregate Resend summaries, and recovers queued jobs after restart.

Verified locally and in CI: shared build, server build, 25 focused tests including cross-client direct-URL isolation, privileged TOTP enforcement, deletion privacy, and ingestion throttling, client typecheck, client production build, production dependency audits, shell syntax, and Compose model validation.

## Production state

- Live URL: `https://analytics.myfusionadmin.com`
- Public source: `https://github.com/mtorres6739/agency-analytics`
- Deployed release source of truth: `/srv/agency-analytics/infra/agency/.deployed-sha` on the production host; every release uses a full immutable commit SHA.
- Runtime: Hetzner `agency-analytics-prod-01`, Ashburn CCX23, Ubuntu 24.04, provider backups enabled, and a 100 GB attached backup volume.
- Edge: Cloudflare proxy, hostname-scoped Full (strict) origin TLS, Browser Integrity Check, edge RUM disabled, and Hetzner 80/443 ingress restricted to Cloudflare's published networks. Direct origin web access is blocked.
- Access: first owner `torres.mathew@gmail.com`, organization display name `SDM`, organization slug `bold-media`, open signup disabled, bootstrap password stored in the local macOS Keychain service `analytics.myfusionadmin.com`, and TOTP active for privileged agency APIs.
- Delivery: immutable public GHCR images, SHA deploy/rollback, every-15-minute external smoke checks, Resend delivery, and private S3 report artifacts.
- Recovery: nightly systemd timer, encrypted Postgres and ClickHouse backups, AES-256 S3 storage, 400-day database-backup retention, 90-day report retention, and successful age/Postgres/ClickHouse archive integrity validation.
- Live browser gate: Lighthouse login scores 90 performance, 100 accessibility, and 100 best practices with no console errors.

Human/pilot gates still required before onboarding all clients: add Google OAuth credentials if Google login is wanted, run the three-site 14-day GA4 comparison pilot, complete projected-load testing with representative event volume, and execute the quarterly full restore into an isolated staging environment. The encrypted artifact integrity check passed, but it is not a substitute for the first clean-environment restoration drill.

The first Vercel pilot is live on `www.neuron-connect.com` as Rybbit site `1` with public tracker property ID `22256ab1cdfe`. The project uses `src/instrumentation-client.ts` plus exact `script-src` and `connect-src` CSP allowances for `https://analytics.myfusionadmin.com`. Preview and canonical-production pageviews were both verified in ClickHouse before and after merge of Neuron Connect PR `#16` on 2026-07-19.

The pilot also validated the complete agency workflow: controlled client creation, team provisioning, site assignment, preview-host exclusions, first-event verification, and 30-day client summary queries. ClickHouse `DateTime64(3)` parameters must use `YYYY-MM-DD HH:mm:ss.SSS`; JavaScript ISO strings with a trailing `Z` fail with `BAD_QUERY_PARAMETER`.

The first Vite automatic-install pilot is live on `arizonatattooremoval.com` as Rybbit site `3` with public tracker property ID `c31cb16ba8c1`. The installer detected the Vercel/GitHub project, added an idempotent managed script to the root `index.html`, waited for a ready preview, squash-merged Arizona Tattoo Removal PR `#3`, and verified the canonical production pageview in ClickHouse on 2026-07-20.

Verified identity uses short-lived signed assertions created only by a website backend after confirmed lead delivery. Per-site secrets are encrypted in Postgres, deployed to Vercel as server-only variables, and activated only after the replacement production deployment is ready. Public/private-link user routes are disabled; identified profile reads require authenticated site access. Palm Squad is the first eligible GHL adapter. Accident Doctor, Neuron Connect, Arizona Tattoo Removal, and R2 Law are enforced compliance blocks; Cummings Pest is blocked by its simulated delivery path.

Palm Squad verified identity went live on 2026-07-21 with active key version 2. The first provisioning attempt failed closed and left key version 1 revoked when Vercel's deployment list returned `uid` instead of `id`; the provider now accepts both shapes and has a matching regression test. Palm uses the versioned tracker URL `script.js?v=verified-identity-v1` so Cloudflare's four-hour cache cannot retain the pre-identity script. Production release `cd34a5717e7636de706208712a7f4e0e28b58fee` passed the immutable-image workflow and Hetzner health-checked deployment. No synthetic production lead was submitted; the first real GHL-delivered lead is the live identification acceptance event.

Anonymous visitors retain deterministic aliases for session continuity, but the user detail header explicitly labels those aliases `Anonymous`. Name and email are displayed only when the site has created a verified identified profile; ordinary pageviews cannot infer either trait.

Provider-neutral visitor identity is implemented behind fail-closed policy gates on `codex/provider-neutral-identity`. CustomersAI and RB2B adapters use configurable signed sandbox endpoints; PDL can fill only missing allowed fields. The SDM tracker owns affirmative consent, honors GPC, restricts resolution to server-derived US traffic, creates encrypted ten-minute BullMQ jobs, stores normalized candidates and field provenance, atomically reserves site and organization budgets, and maintains suppression hashes. Provider identifiers are encrypted only for retryable provider deletion and never returned through application APIs. The Users screen owns the Possible matches review queue, deterministic ICP score, bounded AI brief, and explicit optional GHL routing. OSPRY is excluded. No provider is live until its DPA, data rights, deletion support, sandbox schema, health test, and sub-$750 commitment are approved; Palm Squad remains the shadow-mode consumer pilot.

The identity kill switch applies to every identity source, including dashboard-initiated manual identification. Compliance-blocked or disabled sites do not render the manual action, and the server independently rejects attempts with a stable policy error.

A scoped Cloudflare deployment token covering the 49 active zones present on 2026-07-19 is stored in the local macOS Keychain, not in the repository. The edge planner correctly blocks DNS-only Vercel domains; those projects use the Vercel/GitHub preview-PR adapter instead.

Provider-neutral visitor identity is implemented on PR `#21` and remains disabled by default. The branch is rebased onto production release `dfb4f48a17de06aa3776677b3112fce33713f9d1`. Review hardening makes accepted webhook replay markers durable while releasing rejected attempts, keeps failed consent withdrawals retryable, caches public tracker identity configuration, commits candidate/profile/suppression state before CRM or provider-deletion side effects, and records provider usage once per logical BullMQ attempt. The client rolls failed budget edits back to the last confirmed server state. Next.js is pinned to patched `16.2.11`; production dependency audits for both client and server report zero vulnerabilities after tested transitive overrides.

Final review hardening adds migration `0023` and a transactional provider-deletion outbox so local erasure and the durable external deletion request commit together. Browser consent is scoped by analytics origin and site, immediately stops identity matching during a failed withdrawal while retaining a retry token, waits for `document.body`, and rejects cross-origin connectors. Paid provider pricing is required and finite; invalid pricing or an organization cap outside $0-$750 blocks approval and activation.

No CustomersAI, RB2B, or PDL credentials may be added until the provider supplies approved sandbox schemas, webhook and deletion details, a DPA and subprocessor list, written multi-client display/storage/export/deletion rights, and pricing within the $750 monthly pilot cap. Palm Squad remains the first consumer shadow pilot after those gates pass; provider-derived candidates must not route to GHL or trigger outreach automatically.

## Knowledge rule

Store how this fork works in this wiki. Promote only reusable self-hosting, analytics, security, or agent-workflow patterns to the master Knowledge OS.
