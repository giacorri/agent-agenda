#!/usr/bin/env bash
# add-note — append a note to an existing task in agent-agenda
#
# Usage:
#   add-note <task-id|match> --body "text..."  [--kind text|file|link]
#
# <match> can be a ULID id, or a substring/tag that matches an open task (pending/in_progress/snoozed)
# (the earliest due date wins).

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
body=""
kind="text"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --body) body="$2"; shift 2 ;;
    --kind) kind="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" || -z "$body" ]]; then
  echo "Required: <match> --body \"...\". Optional: --kind text|file|link." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

payload=$(cat <<JSON
{
  "match": $(json_str "$match"),
  "body": $(json_str "$body"),
  "kind": $(json_str "$kind"),
  "agent_session": $(json_str "${CLAUDE_SESSION_ID:-}")
}
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/ingest/note" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "add-note failed ($http_code): $out" >&2
  exit 1
fi

echo "$out"
