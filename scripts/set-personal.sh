#!/usr/bin/env bash
# set-personal — mark (or unmark) a task in agent-agenda as personal
#
# Usage:
#   set-personal <task-id|match>          # mark as personal (adds the 'personal' tag)
#   set-personal <task-id|match> --off    # unmark (removes the 'personal' tag)
#
# <match> = ULID id, or a substring of title/tag/service/requester. Searches tasks in ANY
# status and prefers the most recently created match. Personal tasks stay out of the work
# views and get a distinct cyan tint. At creation use add-task.sh --personal instead.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
personal=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --off)     personal=false; shift ;;
    --on)      personal=true; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" ]]; then
  echo "Required: <match>. Add --off to unmark." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

payload=$(cat <<JSON
{ "match": $(json_str "$match"), "personal": $personal }
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/ingest/personal" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-personal failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
