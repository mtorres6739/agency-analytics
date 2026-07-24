# Hetzner Operations Runbook

## Environments

- Production: Ashburn CCX23-equivalent, Ubuntu 24.04 LTS, local NVMe for hot databases, attached volume for operational headroom.
- Staging: smaller CPX instance with synthetic/pilot data and the same Compose topology.
- Public ports: 80/443 only. SSH uses Tailscale or an explicit allowlist.

Current production allocation:

- Hostname: `analytics.myfusionadmin.com`
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

Install the committed nightly timer with `sudo ./infra/agency/install-backup-timer.sh`. It runs at 03:15 UTC with up to 30 minutes of jitter and catches up after downtime. Confirm the first run with `systemctl status agency-analytics-backup.service` and verify the encrypted object in offsite storage.

## Restore drill

Quarterly, create a clean staging environment and restore Postgres and ClickHouse. Verify login, organization membership, two-client isolation, analytics totals, goals, report schedules, and a sample report. Record elapsed time and any deviation from RPO 24 hours/RTO four hours.

Use `infra/agency/restore.sh <encrypted-archive>` only in a clean recovery environment. `BACKUP_AGE_IDENTITY` must point to the root-readable age private key. Never restore over production as a test.

## Monitoring

- External HTTPS checks for the application and `/api/health`.
- `.github/workflows/production-smoke.yml` checks health, application reachability, HSTS, CSP, and MIME-sniffing protection every 15 minutes from outside Hetzner.
- Container health for client, backend, Postgres, ClickHouse, Redis, and Caddy.
- Alerts for CPU/disk over 70%, database health, ingestion queue lag over one minute, report failure rate, backup age, and TLS expiry.
- Capacity review monthly and before bulk client onboarding.

## Upstream maintenance

- Review upstream monthly and on security releases.
- Pin and record the upstream SHA.
- Re-run server tests, client lint/typecheck/build, tenant isolation, and Docker smoke checks.
- Never deploy the floating `latest` tag.

## Tracking installation operations

The client onboarding screen invokes the provider contract through backend BullMQ jobs. **Detect and plan** remains available as a read-only operator action. In production, `TRACKING_AUTO_DEPLOY_ENABLED=true` makes ordinary web-site creation provision its client/team boundary and enqueue a plan with automatic apply. Cloudflare installs and verifies the site-scoped Worker. Vercel creates a GitHub pull request, waits for a successful preview, and squash-merges it; older Next.js App Router projects receive an idempotent root-layout integration when `instrumentation-client` is unavailable, and Vite projects receive an idempotent managed script in the root `index.html`. The empty site dashboard shows this durable deployment state instead of manual snippet instructions. Set both tracking flags only after the least-privilege provider variables in `.env.production` are configured.

Automatic detection checks an already-proxied Cloudflare hostname first, then searches Vercel projects/domains. DNS-only WordPress is detected but blocked until that site has either a supported Cloudflare path or WP-CLI/SFTP/managed-connector access. The application must continue to state this limitation explicitly.

Use `infra/tracking-edge` for an already Cloudflare-proxied domain and `infra/tracking-vercel` for a DNS-only Next.js or Vite project on Vercel. Never enable the Cloudflare proxy solely to make tracker deployment easier; that is a separate networking change requiring application review.

Cloudflare sequence:

1. Copy `site-manifest.example.json` to the ignored `site-manifest.json` and enter the exact production hostname and Rybbit site ID.
2. Run `npm test` and `npm run plan:keychain`.
3. Resolve any unproxied DNS or Worker route conflict. Do not replace an existing route.
4. Run `npm run apply:keychain`, then `npm run verify`.
5. Open the real website in a browser and use the client page **Verify** button to prove event ingestion.
6. Run `npm run rollback:keychain` to remove only those site-scoped routes if acceptance fails.

Vercel sequence:

1. Enter the exact hostname, Rybbit site ID, and Vercel project in the ignored manifest.
2. Run `npm test` and `npm run plan`.
3. Run `npm run apply`; inspect the generated PR and `npm run status` output.
4. Test the Vercel preview in a real browser and verify event ingestion before merging.
5. Use `npm run rollback` only while the PR is unmerged. After merge, use a normal revert PR.

The workstation Cloudflare deployment token is stored in macOS Keychain service `agency-analytics-cloudflare-tracking-edge`. It is limited to Workers script deployment plus zone/DNS read and Worker route changes for the 49 active zones present on 2026-07-19. Expand or rotate it when zones change; never replace it with the Global API key. Local operator scripts load Vercel and GitHub credentials from their authenticated CLIs; the production backend reads dedicated equivalents from its root-readable environment. Credentials are never printed or committed.

For production onboarding, copy only the dedicated installer tokens into the root-readable server environment and pass them to the backend container. Do not reuse the Cloudflare Global API key. Rotate or remove the server-side tokens to immediately disable provider mutations; setting `TRACKING_INSTALLER_ENABLED=false` disables provider work and `TRACKING_AUTO_DEPLOY_ENABLED=false` stops site creation from provisioning or queuing automatic deployments.

## Verified identity operations

Set `IDENTITY_KEY_ENCRYPTION_SECRET` once in the root-readable production environment; changing it without a coordinated key rotation makes stored site secrets undecryptable. Keep `IDENTITY_BLOCKED_DOMAINS` aligned with the medical/legal compliance register.

For an approved Vercel site, run `npm run identity:provision -- <numeric-site-id> --enable` inside the backend release. The command creates an encrypted pending key, writes `RYBBIT_IDENTITY_SECRET` and `RYBBIT_SITE_ID` to the exact Vercel project, starts a production redeploy, waits for readiness, then activates the key. Rotation preserves the old active key until the new deployment is ready and accepts the retired key only during the assertion grace window.

The emergency kill switch is `enabled=false` in `site_identity_settings` or the Identity settings screen. It stops new identification immediately without interrupting anonymous pageviews. Do not enable a blocked medical or legal domain by editing the database; approval requires an explicit reviewed policy change.

## Provider-neutral identity operations

Apply Drizzle migrations `0017` through `0023` before starting a release containing provider identity. Migration `0023` adds the durable provider-deletion outbox. Configure only the approved provider's server variables from `infra/agency/.env.production.example`; leave unused providers blank. Provider pricing must be a positive integer in micros, and the organization pilot budget must be a finite integer no greater than 75,000 cents. The backend refuses provider approval or site activation when pricing is missing or invalid, or unless the provider connection has durable contract attestations, a successful health check, the required transport and deletion capabilities, and the site compliance state is approved. A configured key by itself does not activate resolution.

Use `/providers` for organization-level provider runtime readiness, capabilities, contract attestations, bounded evidence references, health checks, approval, and disablement. Use the Site Settings Identity tab for the site kill switch, shadow mode, resolver selection, PDL toggle, daily cap, and monthly cap. The maximum accepted per-site monthly cap is $750, and `IDENTITY_PILOT_MONTHLY_BUDGET_CENTS` enforces an atomic organization-wide cap that can never exceed $750. `IDENTITY_CONNECTOR_URL`, when used for a pixel bridge, must be served from the analytics origin so managed websites never need a vendor-specific script or CSP entry.

During an incident, disable `site_resolution_settings.enabled` first. Removing provider API keys and webhook secrets disables external calls globally. Anonymous analytics remains available. See `docs/PROVIDER_IDENTITY.md` for activation, webhook, withdrawal, and pilot acceptance details.
