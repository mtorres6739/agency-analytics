#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <full-40-character-commit-sha>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"
STATE_FILE="${SCRIPT_DIR}/.deployed-sha"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${REPO_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
TARGET_SHA="$1"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

PREVIOUS_SHA=""
if [[ -f "${STATE_FILE}" ]]; then
  PREVIOUS_SHA="$(tr -d '[:space:]' < "${STATE_FILE}")"
fi

deploy_sha() {
  local sha="$1"
  IMAGE_TAG="${sha}" "${COMPOSE[@]}" pull backend client
  IMAGE_TAG="${sha}" "${COMPOSE[@]}" up -d --remove-orphans
}

deploy_sha "${TARGET_SHA}"

for attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 5 "https://$(sed -n 's/^DOMAIN_NAME=//p' "${ENV_FILE}")/api/health" >/dev/null; then
    printf '%s\n' "${TARGET_SHA}" > "${STATE_FILE}"
    echo "Deployment healthy at ${TARGET_SHA}"
    exit 0
  fi
  sleep 2
done

echo "Health check failed for ${TARGET_SHA}" >&2
if [[ "${PREVIOUS_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Rolling back to ${PREVIOUS_SHA}" >&2
  deploy_sha "${PREVIOUS_SHA}"
fi
exit 1

