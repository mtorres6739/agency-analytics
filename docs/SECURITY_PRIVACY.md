# Security and Privacy Requirements

## Dependency baseline

As of 2026-07-19, `npm audit --omit=dev` reports zero production advisories for the server and two moderate advisories for the client. The remaining client findings are inherited through Next.js/PostCSS and npm proposes an unsafe framework downgrade rather than a compatible patch. No high or critical production advisory remains. Recheck on every immutable image build and block release on any high/critical result.

## Trust boundaries

- The browser is untrusted.
- Tracking endpoints accept untrusted public traffic and must remain isolated from administrative work.
- Organization, client, site, report, and recipient IDs are references, not authorization.
- Postgres, ClickHouse, Redis, backup storage, Google OAuth, Resend, and Mapbox are separate trust boundaries.

## Tenant isolation

- Resolve authenticated organization membership on every agency route.
- Owners/admins may manage clients. Analysts may read all agency analytics. Client viewers receive only team/site-restricted reads.
- Resolve a client's site IDs in the database and intersect them with the caller's accessible site IDs.
- Return the same 404 response for nonexistent and inaccessible client resources where disclosure would leak tenant state.
- Test two organizations, two clients in one organization, direct URL changes, API identifiers, exports, and signed links.

## Secrets

- Keep authentication, database, Redis, Google, Resend, object storage, and backup credentials in root-readable environment files or the deployment secret store.
- No secret may use a `NEXT_PUBLIC_` name.
- Logs redact authorization headers, cookies, OAuth tokens, recipient addresses, and signed URLs.
- Rotate credentials after suspected disclosure and at least annually.
- Tracking deployment uses a separate Cloudflare token limited to Workers Scripts Write, Zone Read, DNS Read, and Workers Routes Write on explicit account zones. The Global API key is bootstrap-only and must not be used by the installer.
- Vercel/GitHub installation opens a preview PR and does not merge production. Generated source contains only a public analytics origin and numeric site ID.
- WordPress Application Passwords are sent only to the exact HTTPS site origin and are never stored in the client application or analytics database.

## Data collection

- `trackIp=false`, `sessionReplay=false`, and identified-user tracking off by default.
- Onboarding requires excluded IP, country, path, hostname, and replay masking review.
- Do not send form fields, email addresses, phone numbers, names, or query-string PII as analytics properties.
- Client legal owners decide whether base analytics or optional replay/identify requires consent in their jurisdiction.

## Retention

- Events and uptime: 13 months.
- Bot events: three months.
- Replay events and metadata: 14 days when enabled.
- Report artifacts: 90 days.
- Audit events: 24 months.
- Backup sets: 30 daily and 12 monthly restore points.

## Application controls

- Secure, HTTP-only, SameSite cookies and HSTS.
- Content Security Policy compatible with the tracker, Mapbox, and approved integrations.
- Request-size limits, public ingestion rate protection, and administrative mutation throttles.
- TOTP 2FA required for agency owners/admins before production.
- `ENFORCE_AGENCY_TWO_FACTOR=true` rejects privileged authenticated API access until Better Auth TOTP enrollment is complete. TOTP secrets and backup codes are encrypted with `BETTER_AUTH_SECRET`, failed challenges lock after five attempts for 15 minutes, and client viewers are not forced into the agency-admin policy.
- Open signup disabled after bootstrap.
- Public dashboards and permanent private links disabled by default.
- Tracking installers fail closed on domain/site ambiguity, DNS-only edge targets, inherited Worker route conflicts, existing Next.js instrumentation, unsupported framework versions, and incompatible CSP.

## Incident response

1. Contain by disabling affected credentials, routes, or integrations.
2. Preserve redacted logs and audit events.
3. Identify affected organizations, clients, sites, and time window.
4. Restore from a verified clean release or backup.
5. Notify stakeholders according to contractual and legal requirements.
6. Document the cause and add a regression control.
