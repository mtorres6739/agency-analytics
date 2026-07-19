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
- `.github/workflows/agency-images.yml` verifies and publishes commit-SHA images to GHCR.
- Better Auth TOTP, encrypted backup codes, account lockout, and server-side privileged-role enforcement protect agency owners and administrators.
- `server/src/services/agencyReports/` dispatches due schedules through BullMQ, renders private PDFs, stores encrypted S3 artifacts, creates seven-day signed downloads, sends aggregate Resend summaries, and recovers queued jobs after restart.

Verified locally: shared build, server build, 25 focused tests including cross-client direct-URL isolation, privileged TOTP enforcement, deletion privacy, and ingestion throttling, client typecheck, client production build, shell syntax, and Compose model validation.

Production infrastructure is provisioned at `analytics.boldmedia.cc` on an Ashburn Hetzner CCX23 with a strict firewall, provider backups, and a 100 GB attached backup volume. Remaining release checks are image publication, secret injection, live migration/deployment, Cloudflare proxy hardening, first-owner TOTP enrollment, external monitoring, restore verification, browser accessibility QA, load testing, and the three-site 14-day GA4 pilot.

## Knowledge rule

Store how this fork works in this wiki. Promote only reusable self-hosting, analytics, security, or agent-workflow patterns to the master Knowledge OS.
