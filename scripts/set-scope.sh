#!/usr/bin/env bash
# set-scope — create or update a scope in agent-agenda (work / personal-style views)
#
# Usage:
#   set-scope --key work --label "Work" [--tag ""] [--sort 0]
#   set-scope personal --label "Personal" --tag personal --sort 1
#
# A scope is a top-level view filter. `tag` is the task tag that marks membership;
# an empty tag means the default scope (tasks with no scope tag). Re-running with the
# same --key updates the existing row (upsert). Default sort=0.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

key=""
label=""
tag=""
tag_set=0
sort=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   key="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --tag)   tag="$2"; tag_set=1; shift 2 ;;
    --sort)  sort="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$key" ]]; then key="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$key" ]]; then
  echo "Required: --key \"...\". Recommended: --label. Optional: --tag, --sort." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

# --tag is sent when given even if empty, so callers can pin a scope to "" (default
# scope) explicitly; other unset fields fall back to backend defaults / existing row.
fields="\"key\": $(json_str "$key")"
[[ -n "$label" ]]      && fields+=", \"label\": $(json_str "$label")"
[[ "$tag_set" -eq 1 ]] && fields+=", \"tag\": $(json_str "$tag")"
[[ -n "$sort" ]]       && fields+=", \"sort\": $sort"

payload="{ $fields }"

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/config/scopes" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "set-scope failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
