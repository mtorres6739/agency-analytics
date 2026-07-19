#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

install -m 0644 "${SCRIPT_DIR}/systemd/agency-analytics-backup.service" /etc/systemd/system/agency-analytics-backup.service
install -m 0644 "${SCRIPT_DIR}/systemd/agency-analytics-backup.timer" /etc/systemd/system/agency-analytics-backup.timer
systemctl daemon-reload
systemctl enable --now agency-analytics-backup.timer
systemctl show agency-analytics-backup.timer --property=ActiveState --property=NextElapseUSecRealtime

