# Agency Analytics Platform PRD

Status: Approved for v1 implementation  
Upstream baseline: Rybbit `3ac02f2d4983fb4865e02e22732ff2bba3512cf0`  
License model: AGPL-3.0 maintained fork with MIT-compatible Preline assets

## Product objective

Give the agency one trustworthy analytics system for every client. Agency staff can see portfolio health, onboard websites, configure conversions, and deliver reports. Client users see only the sites assigned to their client.

The platform must preserve Rybbit's tracking and analytics engine. Agency features stay isolated so upstream releases remain mergeable.

## Users and permissions

| Persona | Product access |
| --- | --- |
| Agency owner | All clients and sites, members, security, infrastructure-facing settings, reports |
| Agency admin | All clients and sites, onboarding, GSC, uptime, members, reports |
| Agency analyst | All analytics and reports; no member, security, or infrastructure administration |
| Client viewer | Analytics and reports for the client's assigned sites only |

Client-supplied organization, client, site, schedule, or report identifiers never authorize access. The server derives the allowed organization, client, and site set from the authenticated user on every request.

## Primary workflows

### Agency portfolio

1. Open `/portfolio`.
2. Select a reporting period and optional client/site filters.
3. Review visitors, sessions, conversions, conversion rate, uptime, tracking state, and report health.
4. Open a client or site needing attention.

### Client onboarding

1. Create the client and its restricted access team.
2. Add a site with domain, timezone, and installation method.
3. Apply privacy defaults and exclusions.
4. Install and verify the tracking script.
5. Configure primary conversion goals.
6. Connect Google Search Console and create an uptime monitor.
7. Invite restricted client viewers.
8. Enable weekly or monthly reporting.

### Client reporting

1. A scheduled BullMQ job resolves the client's permitted sites server-side.
2. It computes aggregate metrics, renders a private report, and records a report run.
3. Resend sends a concise email summary with a short-lived report link.
4. Agency staff can inspect, retry, or download the run from `/reports`.

## V1 product surface

- Agency portfolio and client directory.
- Client overview, sites, onboarding status, team visibility, and report history.
- Traffic, acquisition, content, conversions, GSC, Web Vitals, and uptime.
- Restricted client logins.
- Weekly/monthly email and portal reports.
- Production deployment, backups, monitoring, and restore verification.

## Deferred

- Client-managed invitations or billing.
- GA4 historical import.
- Slack delivery and Command Center integration.
- Per-client custom domains.
- Default session replay, identified-user tracking, feature flags, experiments, and custom SQL.

## Privacy defaults

- Raw IP storage disabled.
- Session replay disabled until explicitly enabled; 14-day replay retention.
- Analytics and uptime retention: 13 months. Bot observations: three months.
- Public dashboards and permanent links disabled.
- Reports contain aggregate metrics; detailed artifacts require authentication or a seven-day signed link.
- Sensitive paths, forms, selectors, and internal traffic exclusions are reviewed during onboarding.

## Success measures

- A new site records a verified event within 15 minutes.
- Cross-client access attempts fail in UI, API, exports, and report links.
- Thirty-day dashboards respond within two seconds at p95 at the target scale.
- Event ingestion succeeds above 99.9% at five times projected peak traffic.
- Scheduled report delivery succeeds above 99% after retries.
- Restore drills meet RPO 24 hours and RTO four hours.
- Core routes meet WCAG 2.2 AA interaction and contrast expectations.

## Launch boundary

Pilot three representative sites for at least 14 days alongside GA4. Differences caused by cookieless identification, bot filtering, exclusions, and timezone configuration must be explained before broader onboarding.
