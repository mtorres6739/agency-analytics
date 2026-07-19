# Agency Analytics Wireframes

## Navigation map

```text
Portfolio
Clients
  Client overview
  Sites -> existing site analytics
  Reports
  Team
  Onboarding
Reports
Uptime
Settings
```

## Portfolio desktop

```text
+----------------+------------------------------------------------------+
| Brand          | Portfolio         [Client] [Site] [Period] [Compare]|
| Portfolio      +------------------------------------------------------+
| Clients        | Visitors | Sessions | Conversions | Rate | Sites down|
| Reports        +------------------------------------------------------+
| Uptime         | Traffic and conversion trend | Needs attention      |
|                +------------------------------------------------------+
| Settings       | Client | Traffic | Conversions | Uptime | Tracking  |
+----------------+------------------------------------------------------+
```

Mobile replaces the fixed sidebar with a Preline overlay drawer. Filters collapse into a labeled filter sheet; the metric row becomes a two-column grid.

## Client overview

```text
[Logo] Client name   Active   [Site selector] [Period] [Create report]

Visitors | Sessions | Conversions | Rate | Uptime

Traffic and conversions trend       Onboarding / attention

Acquisition          Top content
Search performance   Core Web Vitals
Sites and tracking   Latest report
```

The first viewport answers “how is this client doing?” Detail remains one click away. Empty panels explain the missing integration and provide the permitted next action.

## Client directory

Search and status filters sit above a responsive analytics table. Columns are client, sites, visitors, conversions, uptime, tracking, last report, and actions. On mobile each row becomes a compact card with no hidden destructive action.

## Onboarding

Use a nine-step progress rail on desktop and a compact progress header on mobile. Each step saves independently and can be resumed. The verification step distinguishes no request, blocked request, malformed site ID, and first event received.

## States

Each data surface implements:

- Skeleton matching final geometry.
- No-data state with the next onboarding action.
- Filtered-empty state that preserves filters.
- Partial-data warning with affected integration.
- Stale tracking state with last verified time.
- Service error with retry and reference ID.
- Permission denied without leaking resource existence.

## Preline block families

Use public application sidebars, dashboard headers, KPI cards, chart compositions, analytics tables, filter bars, create/edit forms, onboarding pages, status badges, drawers, and empty states. Adapt them to Rybbit tokens; do not copy a premium template or introduce its demo dependencies.
