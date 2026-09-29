#!/usr/bin/env bash
# set-person — create or update a person (known requester) in agent-agenda
#
# Usage:
#   set-person --key alex --label "Alex" [--role "Manager"] [--sort 0]
#   set-person alex --label "Alex"          # key as first positional
#
# A person is someone who can request a task (the --requester on add-task.sh). `key`
# is the canonical match token; `label` is the display name; `role` is free text.
# Re-running with the same --key updates the existing row (upsert). Default sort=0.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

key=""
label=""
role=""
sort=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   key="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --role)  role="$2"; shift 2 ;;
    --sort)  sort="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$key" ]]; then key="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$key" ]]; then
  echo "Required: --key \"...\". Recommended: --label. Optional: --role, --sort." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

# Only send fields the caller set; the backend fills the rest with defaults (and
# preserves existing values on update).
fields="\"key\": $(json_str "$key")"
[[ -n "$label" ]] && fields+=", \"label\": $(json_str "$label")"
[[ -n "$role" ]]  && fields+=", \"role\": $(json_str "$role")"
[[ -n "$sort" ]]  && fields+=", \"sort\": $sort"

payload="{ $fields }"

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/config/people" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "set-person failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
