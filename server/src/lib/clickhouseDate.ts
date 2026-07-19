/**
 * ClickHouse DateTime64 query parameters do not accept the trailing `Z` in an
 * ISO string. The database and application both run in UTC, so preserve the
 * UTC value while emitting ClickHouse's accepted millisecond format.
 */
export function formatClickHouseDateTime64(value: Date): string {
  return value.toISOString().slice(0, 23).replace("T", " ");
}
