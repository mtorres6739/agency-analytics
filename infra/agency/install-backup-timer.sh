#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

CLICKHOUSE_UID="$(docker exec clickhouse id -u clickhouse)"
CLICKHOUSE_GID="$(docker exec clickhouse id -g clickhouse)"
install -d -o "${CLICKHOUSE_UID}" -g "${CLICKHOUSE_GID}" -m 0750 "${AGENCY_BACKUP_PATH:-/srv/agency-backups}"

install -m 0644 "${SCRIPT_DIR}/systemd/agency-analytics-backup.service" /etc/systemd/system/agency-analytics-backup.service
install -m 0644 "${SCRIPT_DIR}/systemd/agency-analytics-backup.timer" /etc/systemd/system/agency-analytics-backup.timer
systemctl daemon-reload
systemctl enable --now agency-analytics-backup.timer
systemctl show agency-analytics-backup.timer --property=ActiveState --property=NextElapseUSecRealtime
