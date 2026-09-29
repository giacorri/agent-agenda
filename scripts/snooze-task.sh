#!/usr/bin/env bash
# snooze-task — reschedule a task in agent-agenda to a later time
#
# Usage:
#   snooze-task <task-id|match> <until>
#
# <match> = a ULID id, or a substring of a PENDING task's title/tag/service (earliest due wins,
# same rule as add-note.sh).
# <until> = one of: 10m | 1h | tomorrow | 1w | an ISO timestamp (e.g. 2025-01-31T09:30:00Z).
#   10m / 1h     → that long after the task's current due time.
#   tomorrow     → next day at the configured default remind time.
#   1w           → seven days later, at the configured default remind time.
#   ISO          → that exact moment.
# Snoozing reopens the task (status=pending) and moves its due + reminder; it does not edit notes.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
until=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift
      elif [[ -z "$until" ]]; then until="$1"; shift
      else echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$match" || -z "$until" ]]; then
  echo "Required: <task-id|match> <until>. <until> = 10m|1h|tomorrow|1w|ISO." >&2
  exit 2
fi

# Resolve <match> to a task id. A ULID is "01"-prefixed and 26 chars; anything else is treated
# as a substring matched against pending tasks (earliest due first), mirroring findTaskByMatch.
resolve_id() {
  local m="$1"
  if [[ "$m" == 01* && ${#m} -eq 26 ]]; then printf '%s' "$m"; return 0; fi
  local resp code body
  resp=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/tasks?status=pending")
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  [[ "$code" == "200" ]] || { echo "could not list tasks ($code): $body" >&2; return 1; }
  printf '%s' "$body" | MATCH="$m" python3 -c '
import json, os, sys
m = os.environ["MATCH"].lower()
for t in json.load(sys.stdin):  # already ordered by due_at ASC
    hay = [t.get("title","")] + t.get("tags",[]) + t.get("services",[])
    if any(m in (h or "").lower() for h in hay):
        print(t["id"]); break
'
}

id=$(resolve_id "$match")
if [[ -z "$id" ]]; then
  echo "no pending task matched \"$match\"" >&2
  exit 1
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

payload=$(cat <<JSON
{ "until": $(json_str "$until") }
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/tasks/$id/snooze" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "snooze-task failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
