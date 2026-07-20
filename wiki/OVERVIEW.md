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
- `infra/tracking-vercel/` discovers a Vercel project's GitHub source and opens a single-file Next.js 15.3+ instrumentation PR for preview-first installation.
- Client onboarding exposes the provider contract through tenant-scoped BullMQ jobs and durable `tracking_deployments` records. Operator-created plans are read-only until confirmed; site-creation plans can carry the production-only automatic-apply policy. Applies, status refreshes, and rollback remain bound to the assigned site and store sanitized results only.
- Standard website creation now provisions the agency client/team/site boundary and enqueues a zero-touch managed deployment. Cloudflare applies directly; Vercel waits for a successful preview before merging. Older App Router projects receive a managed root-layout tracker, and the empty analytics dashboard displays deployment state instead of generic manual instructions.
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

A scoped Cloudflare deployment token covering the 49 active zones present on 2026-07-19 is stored in the local macOS Keychain, not in the repository. The edge planner correctly blocks DNS-only Vercel domains; those projects use the Vercel/GitHub preview-PR adapter instead.

## Knowledge rule

Store how this fork works in this wiki. Promote only reusable self-hosting, analytics, security, or agent-workflow patterns to the master Knowledge OS.
