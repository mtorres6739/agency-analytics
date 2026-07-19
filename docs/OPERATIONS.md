# Hetzner Operations Runbook

## Environments

- Production: Ashburn CCX23-equivalent, Ubuntu 24.04 LTS, local NVMe for hot databases, attached volume for operational headroom.
- Staging: smaller CPX instance with synthetic/pilot data and the same Compose topology.
- Public ports: 80/443 only. SSH uses Tailscale or an explicit allowlist.

Current production allocation:

- Hostname: `analytics.boldmedia.cc`
- Hetzner server: `agency-analytics-prod-01` (`CCX23`, Ashburn)
- Backup volume: `agency-analytics-prod-backups` (100 GB, mounted at `/srv/agency-backups`)
- Application root: `/srv/agency-analytics`
- SSH: key-only and provider-firewall allowlisted
- Cloudflare: proxied DNS with Full (strict) TLS after origin certificate issuance

## Deployment

1. CI builds client and backend images tagged with the Git commit SHA.
2. Staging pulls the immutable SHA and runs database checks, health probes, and smoke tests.
3. Production records the current SHA, pulls the approved SHA, applies forward-compatible migrations, starts services, and verifies `/api/health` plus an authenticated route.
4. Any failed health probe rolls back to the recorded SHA and stops the release.

The agency report worker runs in the cluster primary process. BullMQ holds delivery jobs and Postgres remains authoritative for run state, attempts, artifact keys, and recovery after restart.

Never run upstream `update.sh` in production. Upstream changes are merged into an upstream-sync branch, reviewed, and released through CI.

## Backup schedule

- Nightly `pg_dump` with compression and verification.
- Nightly ClickHouse-aware backup.
- Redis AOF retained for queue continuity; report jobs remain reconstructable from Postgres.
- Encrypt and copy backups to a US-region S3-compatible bucket.
- Keep 30 daily and 12 monthly restore points.
- Enable Hetzner server backups as an additional recovery layer.

## Restore drill

Quarterly, create a clean staging environment and restore Postgres and ClickHouse. Verify login, organization membership, two-client isolation, analytics totals, goals, report schedules, and a sample report. Record elapsed time and any deviation from RPO 24 hours/RTO four hours.

## Monitoring

- External HTTPS checks for the application and `/api/health`.
- Container health for client, backend, Postgres, ClickHouse, Redis, and Caddy.
- Alerts for CPU/disk over 70%, database health, ingestion queue lag over one minute, report failure rate, backup age, and TLS expiry.
- Capacity review monthly and before bulk client onboarding.

## Upstream maintenance

- Review upstream monthly and on security releases.
- Pin and record the upstream SHA.
- Re-run server tests, client lint/typecheck/build, tenant isolation, and Docker smoke checks.
- Never deploy the floating `latest` tag.
