#!/usr/bin/env bash
# set-title — rename a task in agent-agenda (fix a badly-named title)
#
# Usage:
#   set-title <task-id|match> "New title"
#
# <match> = a ULID id, or a substring of a PENDING task's title/tag/service (oldest due
# wins, same rule as done-task.sh). Only the title changes; every other field is left as
# is. PATCHes the task and prints the updated JSON. For the summary use PATCH directly.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
title=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift
      elif [[ -z "$title" ]]; then title="$1"; shift
      else echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$match" || -z "$title" ]]; then
  echo "Required: <task-id|match> \"New title\"." >&2
  exit 2
fi

# Resolve <match> to a task id. A ULID is "01"-prefixed and 26 chars; anything else is a
# substring matched against pending tasks (earliest due first), mirroring done-task.sh.
# Pending-only match: pass the ULID id to rename a snoozed / in_progress task.
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

payload="{ \"title\": $(json_str "$title") }"

response=$(curl -sS -w "\n%{http_code}" -X PATCH "$AGENDA_URL/api/tasks/$id" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-title failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
