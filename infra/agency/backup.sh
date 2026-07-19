#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${REPO_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="${WORK_DIR}/agency-analytics-${STAMP}.tar.gz"

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

: "${BACKUP_S3_URI:?BACKUP_S3_URI is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"

"${COMPOSE[@]}" exec -T postgres pg_dump --clean --if-exists --no-owner --format=custom \
  --username "${POSTGRES_USER}" "${POSTGRES_DB}" > "${WORK_DIR}/postgres.dump"

CLICKHOUSE_FILE="clickhouse-${STAMP}.zip"
"${COMPOSE[@]}" exec -T clickhouse clickhouse-client \
  --password "${CLICKHOUSE_PASSWORD}" \
  --query "BACKUP DATABASE ${CLICKHOUSE_DB} TO File('/backups/${CLICKHOUSE_FILE}')"
docker cp "clickhouse:/backups/${CLICKHOUSE_FILE}" "${WORK_DIR}/${CLICKHOUSE_FILE}"
"${COMPOSE[@]}" exec -T clickhouse rm -f "/backups/${CLICKHOUSE_FILE}"

tar -czf "${ARCHIVE}" -C "${WORK_DIR}" postgres.dump "${CLICKHOUSE_FILE}"
age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${ARCHIVE}.age" "${ARCHIVE}"
aws s3 cp "${ARCHIVE}.age" "${BACKUP_S3_URI%/}/$(basename "${ARCHIVE}.age")" --only-show-errors
echo "Encrypted backup uploaded: $(basename "${ARCHIVE}.age")"

