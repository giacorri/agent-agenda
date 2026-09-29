#!/usr/bin/env bash
# show-task — print one task in agent-agenda with its notes + next steps (read-back / dedup)
#
# Usage:
#   show-task <task-id|match>      # resolve to a task, print task + notes + steps
#   show-task <match> --json       # raw task JSON (includes notes) instead of the readable view
#
# <match> = a ULID id, or a substring of an OPEN task's title/tag/service — pending, in_progress
# or snoozed (earliest due wins, same rule as add-note.sh). Use it to read a task back before
# adding a possible duplicate, or to review its progress (notes = what happened; steps = plan).
# The readable view carries a "link:" line — the deep link that opens the web app on this task
# (origin from $AGENDA_UI_URL, default http://localhost:4011; $AGENDA_URL is the API).

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"
: "${AGENDA_UI_URL:=http://localhost:4011}"

match=""
raw=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) raw=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
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
# as a substring matched against any OPEN task (pending/in_progress/snoozed, earliest due first),
# mirroring the backend's findTaskByMatch — so an in_progress task is reachable by keyword too.
resolve_id() {
  local m="$1"
  if [[ "$m" == 01* && ${#m} -eq 26 ]]; then printf '%s' "$m"; return 0; fi
  local resp code body
  resp=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/tasks")
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  [[ "$code" == "200" ]] || { echo "could not list tasks ($code): $body" >&2; return 1; }
  printf '%s' "$body" | MATCH="$m" python3 -c '
import json, os, sys
m = os.environ["MATCH"].lower()
for t in json.load(sys.stdin):  # already ordered by due_at ASC
    if t.get("status") == "done": continue   # open = anything not done, like findTaskByMatch
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

response=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/tasks/$id")
http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "show-task failed ($http_code): $out" >&2
  exit 1
fi

if [[ "$raw" -eq 1 ]]; then
  echo "$out"
  exit 0
fi

# Readable view: header line, then notes (the backward timeline) and steps (the forward plan).
printf '%s' "$out" | AGENDA_UI_URL="$AGENDA_UI_URL" python3 -c '
import json, os, sys
t = json.load(sys.stdin)
def row(label, value):
    print(f"{label:<10} {value}")
row("id:", t["id"])
row("link:", os.environ["AGENDA_UI_URL"] + "/task/" + t["id"])
row("status:", t["status"])
row("due:", t["due_at"])
row("title:", t["title"])
if t.get("summary"):   row("summary:", t["summary"])
if t.get("services"):  row("services:", ", ".join(t["services"]))
if t.get("tags"):      row("tags:", ", ".join(t["tags"]))
if t.get("requester"): row("requester:", t["requester"])
steps = t.get("steps") or []
if steps:
    print("steps:")
    for i, s in enumerate(steps, 1):
        print(f"  {i}. {s}")
notes = t.get("notes") or []
if notes:
    print("notes:")
    for n in notes:
        print("  [{}] ({}) {}".format(n["created_at"], n["kind"], n["body"]))
'
