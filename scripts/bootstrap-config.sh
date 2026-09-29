#!/usr/bin/env bash
# bootstrap-config — apply a whole config doc to agent-agenda in one shot (idempotent)
#
# Usage:
#   bootstrap-config <config.json>     # read the doc from a file
#   bootstrap-config -                 # read the doc from stdin
#   cat config.json | bootstrap-config # same (stdin when no file arg)
#
# The doc is a JSON object with any of: categories[], people[], clients[], refs[], scopes[],
# settings{}. Each entity upserts by its key, so re-applying the same doc is a no-op;
# partial docs are fine (omit a section). On success prints the resulting full config
# bundle. Example doc:
#   { "categories": [ { "key": "web", "label": "Web App", "kind": "service" } ],
#     "people":     [ { "key": "alex", "label": "Alex", "role": "Engineering lead" } ],
#     "refs":       [ { "shorthand": "web", "owner_repo": "acme/web-app" } ],
#     "scopes":     [ { "key": "work", "label": "Work", "tag": "" } ],
#     "settings":   { "default_remind_time": "09:30" } }

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

src=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *)
      if [[ -z "$src" ]]; then src="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

# No file arg (or "-") → read the doc from stdin.
if [[ -z "$src" || "$src" == "-" ]]; then
  doc=$(cat)
else
  if [[ ! -f "$src" ]]; then
    echo "no such file: $src" >&2
    exit 2
  fi
  doc=$(cat "$src")
fi

if [[ -z "${doc// }" ]]; then
  echo "Empty config doc. Pass a JSON file or pipe JSON on stdin." >&2
  exit 2
fi

# Validate JSON locally before posting, for a friendlier error than the server's.
if ! printf '%s' "$doc" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  echo "Invalid JSON config doc." >&2
  exit 2
fi

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/config/bootstrap" \
  -H 'Content-Type: application/json' --data-binary "$doc")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "bootstrap-config failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
