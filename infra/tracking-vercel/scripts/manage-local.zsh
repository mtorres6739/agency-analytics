#!/bin/zsh
set -euo pipefail

vercel_auth="$HOME/Library/Application Support/com.vercel.cli/auth.json"
if [[ ! -f "$vercel_auth" ]]; then
  echo "Vercel CLI authentication was not found. Run: vercel login" >&2
  exit 1
fi

export VERCEL_TOKEN="$(jq -er '.token' "$vercel_auth")"
export GITHUB_TOKEN="$(gh auth token)"
exec node "${0:A:h}/manage.mjs" "$@"
