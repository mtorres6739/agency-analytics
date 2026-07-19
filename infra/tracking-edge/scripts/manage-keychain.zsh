#!/bin/zsh
set -euo pipefail

service="agency-analytics-cloudflare-tracking-edge"
token="$(security find-generic-password -s "$service" -a api-token -w)"
if [[ -z "$token" ]]; then
  echo "Cloudflare tracking-edge token was not found in macOS Keychain." >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN="$token"
exec node "${0:A:h}/manage.mjs" "$@"
