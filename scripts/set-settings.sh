#!/usr/bin/env bash
# set-settings — change one or more app settings in agent-agenda without a full bootstrap
#
# Usage:
#   set-settings key=value [key=value ...]
#
# Each arg is a single setting as key=value (value may contain '='; only the first '=' splits).
# This PATCHes the settings map: keys you pass are upserted, the rest are left untouched.
# Examples (placeholders — use your own keys/values):
#   set-settings default_remind_time=09:30
#   set-settings default_remind_time=09:30 some_flag=true
# For a fresh install seed the whole config with bootstrap-config.sh instead; use this for
# one-off tweaks. On success prints the resulting settings map.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

pairs=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) pairs+=("$1"); shift ;;
  esac
done

if [[ ${#pairs[@]} -eq 0 ]]; then
  echo "Required: at least one key=value pair." >&2
  exit 2
fi

# Build the PATCH body from the key=value pairs. Split on the first '=' only so values may
# contain '='; reject an arg with no '=' or an empty key.
payload=$(KV="$(printf '%s\n' "${pairs[@]}")" python3 -c '
import json, os, sys
out = {}
for line in os.environ["KV"].splitlines():
    if "=" not in line:
        sys.stderr.write(f"not a key=value pair: {line}\n"); sys.exit(2)
    k, v = line.split("=", 1)
    if not k:
        sys.stderr.write(f"empty key in: {line}\n"); sys.exit(2)
    out[k] = v
print(json.dumps(out), end="")
')

response=$(curl -sS -w "\n%{http_code}" -X PATCH "$AGENDA_URL/api/config/settings" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-settings failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
