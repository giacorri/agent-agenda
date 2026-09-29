#!/usr/bin/env bash
# list-tasks — list tasks in agent-agenda (this is how an agent asks "what's open?")
#
# Usage:
#   list-tasks                                  # all tasks
#   list-tasks --status pending                 # one status (pending|in_progress|done|snoozed|shelved|all)
#   list-tasks --tag security                   # tasks carrying a tag
#   list-tasks --service web                    # tasks in a configured category
#   list-tasks --from 2025-01-01 --to 2025-02-01  # due-date window (ISO; --to is exclusive)
#   list-tasks --json                           # raw JSON instead of the compact lines
#
# Prints one compact line per task: "<id> · <status> · <due> · <title> · <link>", where
# <link> opens the web app on that task (origin from $AGENDA_UI_URL, default
# http://localhost:4011; $AGENDA_URL is the API).
# Filters combine (AND). Read-back first (here or with show-task.sh) before adding a
# possible duplicate with add-task.sh.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"
: "${AGENDA_UI_URL:=http://localhost:4011}"

status=""
tag=""
service=""
from=""
to=""
raw=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status)  status="$2"; shift 2 ;;
    --tag)     tag="$2"; shift 2 ;;
    --service) service="$2"; shift 2 ;;
    --from)    from="$2"; shift 2 ;;
    --to)      to="$2"; shift 2 ;;
    --json)    raw=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Build the query string only from the filters that were given.
urlenc() { python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]), end="")' "$1"; }
query=""
add_q() { local k="$1" v="$2"; [[ -z "$v" ]] && return 0; [[ -n "$query" ]] && query+="&"; query+="$k=$(urlenc "$v")"; }
add_q status "$status"
add_q tag "$tag"
add_q service "$service"
add_q from "$from"
add_q to "$to"

url="$AGENDA_URL/api/tasks"
[[ -n "$query" ]] && url="$url?$query"

response=$(curl -sS -w "\n%{http_code}" "$url")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "list-tasks failed ($http_code): $out" >&2
  exit 1
fi

if [[ "$raw" -eq 1 ]]; then
  echo "$out"
  exit 0
fi

# Compact "<id> · <status> · <due> · <title> · <link>" line per task.
printf '%s' "$out" | AGENDA_UI_URL="$AGENDA_UI_URL" python3 -c '
import json, os, sys
ui = os.environ["AGENDA_UI_URL"]
tasks = json.load(sys.stdin)
for t in tasks:
    print(" · ".join([t["id"], t["status"], t["due_at"], t["title"], ui + "/task/" + t["id"]]))
'
