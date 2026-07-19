# Agency Analytics Technical Specification

## Architecture

```mermaid
flowchart LR
  W[Client websites] --> C[Caddy and TLS]
  C --> F[Fastify tracking and application API]
  F --> CH[ClickHouse analytics]
  F --> PG[Postgres metadata and auth]
  F --> R[Redis sessions and queues]
  N[Next.js agency application] --> F
  R --> J[Report workers]
  J --> S[Private object storage]
  J --> E[Resend]
```

- Next.js 16 App Router renders the existing site analytics and new agency routes.
- Fastify owns authorization, client lifecycle, reporting commands, and analytics access.
- Postgres is canonical for agency clients, sites, permissions, schedules, runs, and audit events.
- ClickHouse remains canonical for analytics, sessions, replays, Web Vitals, bots, and monitor events.
- Redis remains the session and BullMQ boundary.
- The event ingestion payload is unchanged in v1.

## Fork boundaries

- Custom UI lives under `client/src/app/(agency)` and `client/src/components/agency`.
- Custom client API code lives under `client/src/api/agency`.
- Custom server handlers and services live under `server/src/api/agency` and `server/src/services/agency`.
- Shared public contracts live in `shared/src/agency.ts`.
- Existing `/{site}` routes and analytics query code are reused instead of copied.

## Postgres schema

### agency_clients

| Column | Type | Rules |
| --- | --- | --- |
| id | text | Primary key |
| organization_id | text | Required FK to organization, cascade delete |
| team_id | text | Required unique FK to team, cascade delete |
| name | text | Required |
| slug | text | Required; unique within organization |
| status | text | `active`, `onboarding`, `paused`, `archived` |
| logo_url | text | Optional |
| timezone | text | Required IANA timezone |
| external_ref | text | Optional future integration identifier |
| created_at / updated_at | timestamp | Required |

### agency_client_sites

| Column | Type | Rules |
| --- | --- | --- |
| id | serial | Primary key |
| client_id | text | Required FK to agency client |
| site_id | integer | Required unique FK to sites |
| is_primary | boolean | Default false |
| tracking_method | text | `script`, `gtm`, `cms`, `proxy` |
| tracking_status | text | `pending`, `verified`, `stale`, `error` |
| verified_at / last_checked_at | timestamp | Optional |

### reporting and audit

- `report_schedules`: client, cadence, timezone, send rules, site scope, enabled state, next run.
- `report_recipients`: schedule, name, email, locale, enabled state.
- `report_runs`: period, status, summary JSON, artifact key, attempts, error summary, timestamps.
- `agency_audit_events`: organization, optional client, actor, action, target, sanitized metadata, timestamp.

Client creation and site assignment update the agency tables and Rybbit team access tables in one Postgres transaction.

## Shared contracts

`AgencyClient`, `AgencyClientSite`, `ClientSummary`, `OnboardingState`, `ReportSchedule`, `ReportRecipient`, and `ReportRun` are exported from `@rybbit/shared`. Dates cross the HTTP boundary as ISO 8601 strings.

## HTTP interfaces

- `GET/POST /api/organizations/:organizationId/clients`
- `GET/PATCH /api/organizations/:organizationId/clients/:clientId`
- `POST/DELETE /api/organizations/:organizationId/clients/:clientId/sites`
- `GET /api/organizations/:organizationId/clients/:clientId/summary`
- `GET /api/organizations/:organizationId/clients/:clientId/onboarding`
- CRUD under `/api/organizations/:organizationId/clients/:clientId/report-schedules`
- `GET /api/organizations/:organizationId/clients/:clientId/report-runs`
- `POST /api/organizations/:organizationId/clients/:clientId/report-runs/:runId/retry`

Every handler validates Zod input, verifies organization membership, derives accessible sites on the server, and returns `{ error: string, details?: unknown }` for failures.

## Preline integration

- Install `preline` and `@tailwindcss/forms` using the client's existing npm workflow.
- Add Preline Tailwind v4 source and variant imports to `globals.css`.
- Mount a client-only loader after routed content in the root layout.
- Dynamically import `preline/non-auto` and call `HSStaticMethods.autoInit()` after pathname changes.
- New agency routes use public Preline markup patterns and existing Rybbit tokens. Existing chart libraries and mature Radix behavior remain.

## Report execution

- Scheduler enqueues only schedule IDs; workers reload canonical state before execution.
- The worker resolves site access server-side, calculates the period in the schedule timezone, renders aggregate content, uploads a private artifact, records the run, and sends through Resend.
- Retries use bounded exponential backoff and idempotency key `scheduleId:periodStart:periodEnd`.
- Recipient email addresses and artifact keys never enter analytics events or browser logs.

## Performance and scale

- Initial envelope: 25–100 sites and 1–10 million events/month.
- Dashboard p95 target: under two seconds for 30-day queries.
- Scale triggers: CPU or disk over 70%, ingestion lag over one minute, or p95 above target.
- First resize: CCX33-equivalent. Second step: separate ClickHouse/data and application tiers.
