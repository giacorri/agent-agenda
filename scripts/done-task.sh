#!/usr/bin/env bash
# done-task — mark a task in agent-agenda as done
#
# Usage:
#   done-task <task-id|match>     # resolve to a task, then close it
#
# <match> = a ULID id, or a substring of a PENDING task's title/tag/service (earliest due wins,
# same rule as add-note.sh). Closing sets status=done and stamps completed_at. Log what got
# done as a note first (add-note.sh); for a requester message use set-closing.sh.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" ]]; then
  echo "Required: <task-id|match>." >&2
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

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/tasks/$id/done")
http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "done-task failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
