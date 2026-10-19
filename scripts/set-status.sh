#!/usr/bin/env bash
# set-status — change the status of a task in agent-agenda
#
# Usage:
#   set-status <task-id|match> <status>   # pending | in_progress | snoozed | shelved | done
#
# <match> = a ULID id, or a substring of an OPEN task's title/tag/service (earliest due wins,
# same rule as add-note.sh). Typical use: set-status <match> in_progress when work on a task
# starts. To close a task use done-task.sh, which also stamps completed_at.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
status=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift
      elif [[ -z "$status" ]]; then status="$1"; shift
      else echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$match" || -z "$status" ]]; then
  echo "Required: <task-id|match> <status>." >&2
  exit 2
fi

# Resolve <match> to a task id. A ULID is "01"-prefixed and 26 chars; anything else is treated
# as a substring matched against open tasks (earliest due first), mirroring findTaskByMatch.
resolve_id() {
  local m="$1"
  if [[ "$m" == 01* && ${#m} -eq 26 ]]; then printf '%s' "$m"; return 0; fi
  local resp code body
  resp=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/tasks?status=all")
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  [[ "$code" == "200" ]] || { echo "could not list tasks ($code): $body" >&2; return 1; }
  printf '%s' "$body" | MATCH="$m" python3 -c '
import json, os, sys
m = os.environ["MATCH"].lower()
for t in json.load(sys.stdin):  # already ordered by due_at ASC
    if t.get("status") not in ("pending", "in_progress", "snoozed"): continue
    hay = [t.get("title","")] + t.get("tags",[]) + t.get("services",[])
    if any(m in (h or "").lower() for h in hay):
        print(t["id"]); break
'
}

id=$(resolve_id "$match")
if [[ -z "$id" ]]; then
  echo "no open task matched \"$match\"" >&2
  exit 1
fi

payload=$(STATUS="$status" python3 -c 'import json, os; print(json.dumps({"status": os.environ["STATUS"]}))')
response=$(curl -sS -w "\n%{http_code}" -X PATCH "$AGENDA_URL/api/tasks/$id" \
  -H 'Content-Type: application/json' -d "$payload")
http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-status failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
