#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 <agency-analytics-backup.tar.gz.age>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"
WORK_DIR="$(mktemp -d)"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${REPO_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")

cleanup() {
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required}"

ARCHIVE="${WORK_DIR}/restore.tar.gz"
age --decrypt --identity "${BACKUP_AGE_IDENTITY}" --output "${ARCHIVE}" "$1"
tar -xzf "${ARCHIVE}" -C "${WORK_DIR}"

POSTGRES_DUMP="$(find "${WORK_DIR}" -maxdepth 1 -type f -name 'postgres.dump' -print -quit)"
CLICKHOUSE_BACKUP="$(find "${WORK_DIR}" -maxdepth 1 -type f -name 'clickhouse-*.zip' -print -quit)"
if [[ -z "${POSTGRES_DUMP}" || -z "${CLICKHOUSE_BACKUP}" ]]; then
  echo "Backup archive is incomplete" >&2
  exit 1
fi

"${COMPOSE[@]}" exec -T postgres pg_restore --clean --if-exists --no-owner \
  --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" < "${POSTGRES_DUMP}"

docker cp "${CLICKHOUSE_BACKUP}" "clickhouse:/backups/$(basename "${CLICKHOUSE_BACKUP}")"
"${COMPOSE[@]}" exec -T clickhouse clickhouse-client \
  --password "${CLICKHOUSE_PASSWORD}" \
  --query "RESTORE DATABASE ${CLICKHOUSE_DB} FROM File('/backups/$(basename "${CLICKHOUSE_BACKUP}")') SETTINGS allow_non_empty_tables=true"

echo "Restore completed. Run the authenticated tenant-isolation and report checks before using this environment."
