# Upstream Feature Audit Revalidation

Date: 2026-07-19  
Baseline: `3ac02f2d4983fb4865e02e22732ff2bba3512cf0`  
Source audit: `FEATURE_AUDIT.md` generated 2026-07-06

The imported audit is not a current defect count. This pass re-traced the high-severity findings that affect the agency v1 surface.

## Resolved in the current upstream baseline

| Finding group | Current evidence |
| --- | --- |
| Fresh installs missing event, identity, import, and Web Vitals columns | `ensureEventsColumns()` and the current `events` DDL include the required columns in `server/src/db/clickhouse/clickhouse.ts`. |
| Incomplete or invalid supplied time ranges becoming silent all-time queries | Shared route middleware calls `validateHttpTimeParams` before scoped analytics handlers in `server/src/index.ts`; an intentionally absent range remains the supported all-time mode. |
| Error lists ignoring past-minute and exact ranges | Error hooks now call `buildApiParams` in `client/src/api/analytics/hooks/errors/`. |
| Site directory leaking `apiKey` and `privateLinkKey` | `getSitesFromOrg` strips both fields before returning organization sites. |
| Multi-value negative filters matching everything | Negative string filters now use `AND` joins in `getFilterStatement.ts`. |
| CLS values of zero becoming null | Ingestion uses `pv.cls ?? null` in `pageviewQueue.ts`. |

## Fixed in this fork

| Finding | Resolution | Verification |
| --- | --- | --- |
| Site deletion retained event data and could falsely report success | `deleteSite.ts` deletes raw event, bot, replay, and materialized aggregate rows before configuration; errors return 500. `siteConfig.removeSite` no longer swallows database failures. Import history now cascades on site deletion through migration `0013_brainy_romulus.sql`. | `deleteSite.test.ts` covers all-table deletion and ClickHouse failure behavior. |
| Rate-limited ingestion keys silently degraded to untrusted public tracking | `trackEvent.ts` now distinguishes API-key throttling and returns `429` before bot/session/event processing. | `trackEvent.test.ts` covers the throttled bearer path. |

## Open release decisions

- GSC behavior across all-time, past-minute, and exact-datetime UI modes needs a live connected-property test before M3 exits.
- Acquisition/content/GSC/Web Vitals portfolio aggregation needs contract and load coverage beyond the implemented client summary.
- Experiment lifecycle, advanced funnels/journeys/users, replay range behavior, and other high findings on explicitly post-v1 routes remain upstream-review items before those features are exposed to client viewers.
- Full deletion acceptance still requires a real Postgres/ClickHouse environment to verify mutation completion and aggregate counts after deletion.

No item above is considered production-closed solely from static inspection. Production release still requires the test gates in `docs/TEST_ACCEPTANCE.md`.
